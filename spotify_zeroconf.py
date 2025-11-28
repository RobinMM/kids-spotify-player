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
import sys
import requests
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.backends import default_backend


def debug_log(msg):
    """Print debug message and flush immediately."""
    print(msg)
    sys.stdout.flush()


# Spotify's DH prime (768-bit, van librespot diffie_hellman.rs)
DH_PRIME_BYTES = bytes([
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xc9, 0x0f, 0xda, 0xa2, 0x21, 0x68, 0xc2, 0x34,
    0xc4, 0xc6, 0x62, 0x8b, 0x80, 0xdc, 0x1c, 0xd1,
    0x29, 0x02, 0x4e, 0x08, 0x8a, 0x67, 0xcc, 0x74,
    0x02, 0x0b, 0xbe, 0xa6, 0x3b, 0x13, 0x9b, 0x22,
    0x51, 0x4a, 0x08, 0x79, 0x8e, 0x34, 0x04, 0xdd,
    0xef, 0x95, 0x19, 0xb3, 0xcd, 0x3a, 0x43, 0x1b,
    0x30, 0x2b, 0x0a, 0x6d, 0xf2, 0x5f, 0x14, 0x37,
    0x4f, 0xe1, 0x35, 0x6d, 0x6d, 0x51, 0xc2, 0x45,
    0xe4, 0x85, 0xb5, 0x76, 0x62, 0x5e, 0x7e, 0xc6,
    0xf4, 0x4c, 0x42, 0xe9, 0xa6, 0x3a, 0x36, 0x20,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff
])
DH_PRIME = int.from_bytes(DH_PRIME_BYTES, 'big')
DH_GENERATOR = 2
DH_KEY_SIZE = 96  # 768 bits = 96 bytes


class SpotifyZeroConf:
    """
    Spotify Connect ZeroConf client voor het activeren van librespot devices.
    """

    # Auth types (van Spotify protobuf)
    AUTH_STORED_CREDENTIALS = 1
    AUTH_ACCESS_TOKEN = 5  # OAuth access token

    def __init__(self, credentials_path: str = None, access_token: str = None, username: str = None):
        """
        Initialize met credentials of OAuth access token.

        Args:
            credentials_path: Pad naar credentials.json (legacy)
            access_token: Spotify OAuth access token (aanbevolen)
            username: Spotify username (verplicht bij access_token)
        """
        self.credentials_path = credentials_path
        self._credentials_loaded = False
        self.username = username
        self.auth_type = None
        self.auth_data = None

        # Als access_token is meegegeven, gebruik die
        if access_token and username:
            self.username = username
            self.auth_type = self.AUTH_ACCESS_TOKEN
            self.auth_data = access_token.encode('utf-8')
            self._credentials_loaded = True
        elif credentials_path is None and not access_token:
            self.credentials_path = os.path.expanduser("~/.cache/librespot/credentials.json")

    def _load_credentials(self):
        """Laad stored credentials van disk."""
        if self._credentials_loaded:
            return

        if not self.credentials_path:
            raise ValueError("Geen credentials_path of access_token gegeven")

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

    def _write_varint(self, value: int) -> bytes:
        """Encode integer als variable-length bytes (librespot format)."""
        if value < 0x80:
            return bytes([value])
        else:
            return bytes([
                (value & 0x7f) | 0x80,
                (value >> 7) & 0x7f
            ])

    def _build_credentials_blob(self) -> bytes:
        """
        Bouw de credentials blob structuur in librespot formaat.

        Format:
        - Tag 0x01 + varint(length) + username
        - Tag 0x02 + 32-bit big-endian auth_type
        - Tag 0x03 + varint(length) + auth_data
        """
        blob = bytearray()

        # Username (tag 0x01)
        blob.append(0x01)
        blob.extend(self._write_varint(len(self.username)))
        blob.extend(self.username.encode('utf-8'))

        # Auth type (tag 0x02, 32-bit big-endian)
        blob.append(0x02)
        blob.extend(struct.pack('>I', self.auth_type))

        # Auth data (tag 0x03)
        blob.append(0x03)
        blob.extend(self._write_varint(len(self.auth_data)))
        blob.extend(self.auth_data)

        return bytes(blob)

    def _encrypt_credentials_blob(self, credentials_blob: bytes, device_id: str) -> bytes:
        """
        Encrypt credentials blob met AES-192-ECB.
        Key derivation: SHA1(PBKDF2(SHA1(device_id), username, 256, 1)) || htonl(20)
        """
        # Key derivation stap 1: SHA1(device_id)
        device_id_hash = hashlib.sha1(device_id.encode()).digest()

        # Key derivation stap 2: PBKDF2(SHA1(device_id), username, 256 iterations)
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA1(),
            length=20,
            salt=self.username.encode('utf-8'),
            iterations=256,
            backend=default_backend()
        )
        base_key = kdf.derive(device_id_hash)

        # Key derivation stap 3: SHA1(base_key) + big-endian 20
        key_hash = hashlib.sha1(base_key).digest()
        key = key_hash + struct.pack('>I', 20)  # 24 bytes total for AES-192

        # Pad to 16-byte boundary for ECB (PKCS7)
        pad_len = 16 - (len(credentials_blob) % 16)
        if pad_len == 0:
            pad_len = 16
        padded = credentials_blob + bytes([pad_len] * pad_len)

        # AES-192-ECB encrypt
        cipher = Cipher(algorithms.AES(key), modes.ECB(), backend=default_backend())
        encryptor = cipher.encryptor()
        encrypted = encryptor.update(padded) + encryptor.finalize()

        return encrypted

    def _to_bytes_padded(self, n: int, length: int) -> bytes:
        """Converteer int naar bytes met zero-padding links."""
        if n == 0:
            return bytes(length)
        raw = n.to_bytes((n.bit_length() + 7) // 8, 'big')
        if len(raw) > length:
            return raw[-length:]  # Truncate van links
        return raw.rjust(length, b'\x00')  # Pad met zeros

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
        return self._to_bytes_padded(shared_secret, DH_KEY_SIZE)

    def _encrypt_blob(self, shared_secret: bytes, data: bytes) -> bytes:
        """
        Encrypt data met DH shared secret.

        Returns:
            encrypted blob (IV + encrypted data + MAC)
        """
        # Key derivation - BELANGRIJK: alleen eerste 16 bytes van SHA1!
        sha1_full = hashlib.sha1(shared_secret).digest()
        base_key = sha1_full[:16]  # Eerste 16 bytes, zoals librespot doet
        checksum_key = hmac.new(base_key, b"checksum", hashlib.sha1).digest()
        encryption_key = hmac.new(base_key, b"encryption", hashlib.sha1).digest()[:16]

        # AES-CTR is een stream cipher, geen padding nodig
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
        debug_log(f"[ZeroConf] Step 1: Loading credentials...")
        self._load_credentials()
        debug_log(f"[ZeroConf] Credentials loaded - username: {self.username}, auth_type: {self.auth_type}, auth_data_len: {len(self.auth_data)}")

        # 1. Haal device info op
        debug_log(f"[ZeroConf] Step 2: Getting device info from {ip}:{port}")
        device_info = self.get_device_info(ip, port)
        debug_log(f"[ZeroConf] Device info: status={device_info.get('status')}, deviceID={device_info.get('deviceID')}")

        if device_info.get('status') != 101:
            raise ValueError(f"Device error: {device_info.get('statusString')}")

        device_public_key = device_info['publicKey']
        device_id = device_info.get('deviceID')

        if not device_id:
            raise ValueError("Device info missing deviceID")

        # 2. DH key exchange
        debug_log(f"[ZeroConf] Step 3: DH key exchange...")
        private_key, public_key = self._generate_dh_keys()
        shared_secret = self._compute_shared_secret(device_public_key, private_key)
        debug_log(f"[ZeroConf] Shared secret computed, length: {len(shared_secret)} bytes")

        # 3. Encrypt de credentials blob (dubbele encryptie)
        # Stap 3a: Bouw credentials structuur
        debug_log(f"[ZeroConf] Step 4: Building credentials blob...")
        credentials_blob = self._build_credentials_blob()
        debug_log(f"[ZeroConf] Credentials blob size: {len(credentials_blob)} bytes, hex: {credentials_blob[:20].hex()}...")

        # Stap 3b: AES-192-ECB encrypt met device_id derived key (inner layer)
        debug_log(f"[ZeroConf] Step 5: Inner encryption (AES-192-ECB)...")
        inner_encrypted = self._encrypt_credentials_blob(credentials_blob, device_id)
        debug_log(f"[ZeroConf] Inner encrypted size: {len(inner_encrypted)} bytes")

        # Stap 3c: Base64 encode voor de outer layer
        inner_blob_b64 = base64.b64encode(inner_encrypted)
        debug_log(f"[ZeroConf] Inner blob b64 length: {len(inner_blob_b64)} bytes")

        # Stap 3d: AES-128-CTR encrypt met DH shared secret (outer layer)
        debug_log(f"[ZeroConf] Step 6: Outer encryption (AES-128-CTR)...")
        encrypted_blob = self._encrypt_blob(shared_secret, inner_blob_b64)
        debug_log(f"[ZeroConf] Final blob size: {len(encrypted_blob)} bytes")

        # 4. Encode voor transport
        blob_b64 = base64.b64encode(encrypted_blob).decode()
        client_key_b64 = base64.b64encode(
            self._to_bytes_padded(public_key, DH_KEY_SIZE)
        ).decode()
        debug_log(f"[ZeroConf] Client key b64 length: {len(client_key_b64)}")

        # 5. Stuur addUser request
        debug_log(f"[ZeroConf] Step 7: Sending addUser request to {ip}:{port}...")
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
        debug_log(f"[ZeroConf] addUser response: {result}")

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
