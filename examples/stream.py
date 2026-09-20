from pairit import Client


client = Client(provider="chatgpt")

try:
    for chunk in client.chat(
        "Explain async programming in Python",
        stream=True,
    ):
        print(
            chunk.content,
            end="",
            flush=True,
        )

    print()
finally:
    client.close()
