from pair import Client


client = Client(provider="chatgpt")

try:
    response = client.chat("who invent phone")
    print(response.content)
finally:
    client.close()
