from aiohttp import client_exceptions
from pairit import Client

# Initialize the local offline model
client = Client("qwen3-0.6b")

response = client.chat('what is my name')

print(response.content)

