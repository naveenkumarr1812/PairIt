from pairit import Client


client = Client("chatgpt")

try:
    response = client.chat("who invent phone")
    print(response.content)
finally:
    client.close()
