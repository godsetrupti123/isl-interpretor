import asyncio
import websockets
import json
import base64
from pathlib import Path
from PIL import Image
import io
import torch

def create_dummy_image():
    # Create a simple red 224x224 image
    img = Image.new('RGB', (224, 224), color = 'red')
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format='JPEG')
    return img_byte_arr.getvalue()

async def test_websocket():
    uri = "ws://localhost:8000/ws/predict"
    
    print(f"Connecting to {uri}...")
    try:
        async with websockets.connect(uri) as websocket:
            print("Connected! Sending dummy image...")
            
            image_bytes = create_dummy_image()
            await websocket.send(image_bytes)
            
            print("Waiting for response...")
            response = await websocket.recv()
            
            print("\nResponse received:")
            print(json.dumps(json.loads(response), indent=2))
            
    except ConnectionRefusedError:
        print("Error: Could not connect to the server. Is it running?")
        print("Run: uvicorn main:app --reload --port 8000 (inside the backend directory)")

if __name__ == "__main__":
    print("This script requires the 'websockets' package.")
    print("Run `pip install websockets` if it's not installed.")
    print("-" * 40)
    asyncio.run(test_websocket())
