import torchvision.transforms as transforms
from PIL import Image
import io

def get_inference_transforms():
    """
    Returns the exact torchvision transforms to match EfficientNet-B0
    training preprocessing.
    """
    return transforms.Compose([
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], 
                             std=[0.229, 0.224, 0.225])
    ])

def preprocess_image(image_bytes: bytes) -> tuple[torch.Tensor, Image.Image]:
    """
    Decodes the image bytes and applies the inference transforms.
    Returns the batched tensor and the original PIL Image.
    """
    import torch
    
    # Open image and convert to RGB (strips alpha channel if present)
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    
    # Apply transforms
    transform = get_inference_transforms()
    tensor = transform(img)
    
    # Add batch dimension: (1, C, H, W)
    tensor = tensor.unsqueeze(0)
    
    return tensor, img
