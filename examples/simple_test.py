from pairit import Client

client = Client("qwen3-0.6b")

try:
	response = client.chat("What is my name?")
	print(response.content)
finally:
	client.close()

