import sys

with open(r'f:\now stx ccclan\server.js', 'rb') as f:
    content = f.read()
    for i, byte in enumerate(content):
        if byte > 127:
            print(f"Non-ASCII byte: {byte} at position {i}")
