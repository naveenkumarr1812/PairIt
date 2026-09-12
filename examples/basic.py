from pair import Client

client = Client(provider="chatgpt")

print("PAIR bridge started.")
print("Turn ON the PAIR Chrome extension...")
print("Waiting for PAIR to connect...")

if not client.wait_for_extension(timeout=120):
    raise RuntimeError(
        "PAIR did not connect within 120 seconds. "
        "Turn ON the PAIR Chrome extension and try again."
    )

print("PAIR connected!")

response = client.chat(
    "who invented switches"
)

print(response.content)