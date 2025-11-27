"""
Spotify Connect ZeroConf client voor het activeren van librespot devices.

Dit module implementeert de ZeroConf addUser flow om een librespot device
te activeren zodat het verschijnt in de Spotify Web API.
"""

import base64
import hashlib
import hmac
import json
import os
import struct
import requests
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend


# Spotify's DH prime (RFC 2409, 1536-bit MODP Group)
DH_PRIME = int(
    "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1"
    "29024E088A67CC74020BBEA63B139B22514A08798E3404DD"
    "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245"
    "E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED"
    "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE65381"
    "FFFFFFFFFFFFFFFF",
    16
)
DH_GENERATOR = 2


class SpotifyZeroConf:
    """
    Spotify Connect ZeroConf client voor het activeren van librespot devices.
    """

    def __init__(self, credentials_path: str = None):
        """
        Initialize met pad naar librespot credentials.json

        Args:
            credentials_path: Pad naar credentials.json
                              (default: ~/.cache/librespot/credentials.json)
        """
        if credentials_path is None:
            credentials_path = os.path.expanduser("~/.cache/librespot/credentials.json")

        self.credentials_path = credentials_path
        self._credentials_loaded = False
        self.username = None
        self.auth_type = None
        self.auth_data = None

    def _load_credentials(self):
        """Laad stored credentials van disk."""
        if self._credentials_loaded:
            return

        with open(self.credentials_path, 'r') as f:
            creds = json.load(f)

        self.username = creds['username']
        self.auth_type = creds['auth_type']
        self.auth_data = base64.b64decode(creds['auth_data'])
        self._credentials_loaded = True

    def get_device_info(self, ip: str, port: int) -> dict:
        """
        Haal device informatie op via getInfo endpoint.

        Args:
            ip: IP adres van het device
            port: Poort van het device

        Returns:
            dict met device info (publicKey, deviceID, etc.)
        """
        url = f"http://{ip}:{port}/?action=getInfo"
        response = requests.get(url, timeout=5)
        response.raise_for_status()
        return response.json()

    def _generate_dh_keys(self):
        """Genereer DH keypair."""
        private_key = int.from_bytes(os.urandom(95), 'big') % DH_PRIME
        public_key = pow(DH_GENERATOR, private_key, DH_PRIME)
        return private_key, public_key

    def _compute_shared_secret(self, device_public_key_b64: str, private_key: int) -> bytes:
        """Bereken DH shared secret."""
        device_public_key_bytes = base64.b64decode(device_public_key_b64)
        device_public_key = int.from_bytes(device_public_key_bytes, 'big')
        shared_secret = pow(device_public_key, private_key, DH_PRIME)
        return shared_secret.to_bytes(96, 'big')

    def _encrypt_blob(self, shared_secret: bytes, data: bytes) -> bytes:
        """
        Encrypt data met DH shared secret.

        Returns:
            encrypted blob (IV + encrypted data + MAC)
        """
        # Key derivation
        base_key = hashlib.sha1(shared_secret).digest()
        checksum_key = hmac.new(base_key, b"checksum", hashlib.sha1).digest()
        encryption_key = hmac.new(base_key, b"encryption", hashlib.sha1).digest()[:16]

        # Pad data to 16-byte boundary
        pad_len = 16 - (len(data) % 16)
        if pad_len < 16:
            data = data + bytes([pad_len] * pad_len)

        # Encrypt met AES-128-CTR
        iv = os.urandom(16)
        cipher = Cipher(
            algorithms.AES(encryption_key),
            modes.CTR(iv),
            backend=default_backend()
        )
        encryptor = cipher.encryptor()
        encrypted = encryptor.update(data) + encryptor.finalize()

        # HMAC voor integriteit
        mac = hmac.new(checksum_key, encrypted, hashlib.sha1).digest()

        return iv + encrypted + mac

    def activate_device(self, ip: str, port: int) -> dict:
        """
        Activeer een librespot device via ZeroConf addUser.

        Args:
            ip: IP adres van het device
            port: Poort van het device

        Returns:
            dict met response van het device

        Raises:
            requests.RequestException: Bij netwerk fouten
            ValueError: Bij ongeldige response
            FileNotFoundError: Als credentials niet gevonden worden
        """
        # Load credentials if not already loaded
        self._load_credentials()

        # 1. Haal device info op
        device_info = self.get_device_info(ip, port)

        if device_info.get('status') != 101:
            raise ValueError(f"Device error: {device_info.get('statusString')}")

        device_public_key = device_info['publicKey']

        # 2. DH key exchange
        private_key, public_key = self._generate_dh_keys()
        shared_secret = self._compute_shared_secret(device_public_key, private_key)

        # 3. Encrypt de credentials blob
        encrypted_blob = self._encrypt_blob(shared_secret, self.auth_data)

        # 4. Encode voor transport
        blob_b64 = base64.b64encode(encrypted_blob).decode()
        client_key_b64 = base64.b64encode(
            public_key.to_bytes(96, 'big')
        ).decode()

        # 5. Stuur addUser request
        url = f"http://{ip}:{port}/"
        response = requests.post(
            url,
            data={
                'action': 'addUser',
                'userName': self.username,
                'blob': blob_b64,
                'clientKey': client_key_b64
            },
            timeout=10
        )

        result = response.json()

        if result.get('status') != 101:
            raise ValueError(
                f"addUser failed: {result.get('statusString')} "
                f"(spotifyError: {result.get('spotifyError')})"
            )

        return result

    def check_device_active(self, ip: str, port: int) -> bool:
        """Check of een device al een actieve user heeft."""
        info = self.get_device_info(ip, port)
        return bool(info.get('activeUser'))


def activate_librespot(ip: str, port: int, credentials_path: str = None) -> dict:
    """
    Activeer een librespot device.

    Args:
        ip: IP adres van het device
        port: Poort van het device
        credentials_path: Optioneel pad naar credentials.json

    Returns:
        Response dict van het device
    """
    client = SpotifyZeroConf(credentials_path)
    return client.activate_device(ip, port)
