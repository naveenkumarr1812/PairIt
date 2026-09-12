from pair import Client

client = Client(provider="claude")

try:
    response = client.chat("who invented bulb")
    print(response.content)
finally:
    client.close()