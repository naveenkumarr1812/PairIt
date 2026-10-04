import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from pairit import Client
from pairit.exceptions import ModelNotDownloadedError

client = Client("qwen3-0.6b")

try:
    print("Waiting for extension connection...")
    if not client.wait_for_extension(timeout=10.0):
        print("[-] PairIt extension not connected. Please toggle it ON in Chrome.")
    else:
        print("[+] Extension connected. Sending prompt to 'qwen3-0.6b'...")
        result = client.chat(
            "What are the advantages of local AI models? Keep it brief in 2 sentences.",
            max_tokens=64,
        )
        print(f"\nModel: {result.model}")
        print(f"Content:\n{result.content}")
        if result.backend:
            print(f"Backend: {result.backend}")
except ModelNotDownloadedError:
    print("\n[!] Model 'qwen3-0.6b' is not downloaded yet.")
    print("-> Open the PairIt Chrome extension popup, scroll to 'Stateless Models', and click 'Download' next to Qwen3 0.6B.")
except Exception as e:
    print(f"\n[!] Error: {e}")
finally:
    client.close()
