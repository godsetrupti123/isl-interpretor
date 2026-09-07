import torch
import torch.nn as nn
import torchvision.models as models
import json
import os
from pathlib import Path
from .preprocessing import preprocess_image

class Predictor:
    def __init__(self, model_path: str, classes_path: str):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model_path = model_path
        self.classes_path = classes_path
        self.classes = []
        self.model = None
        
        self._load_classes()
        self._load_model()
        
    def _load_classes(self):
        with open(self.classes_path, "r") as f:
            raw_classes = json.load(f)
            # Remove leading spaces from classes
            self.classes = [c.strip() for c in raw_classes]
            
    def _load_model(self):
        # Initialize EfficientNet B0
        self.model = models.efficientnet_b0(weights=None)
        
        # Modify the classifier to match the 35 classes
        num_ftrs = self.model.classifier[1].in_features
        self.model.classifier[1] = nn.Linear(num_ftrs, len(self.classes))
        
        # Load the weights
        state_dict = torch.load(self.model_path, map_location=self.device)
        self.model.load_state_dict(state_dict)
        
        self.model.to(self.device)
        self.model.eval()
        
    @torch.inference_mode()
    def predict(self, image_bytes: bytes) -> dict:
        try:
            tensor, _ = preprocess_image(image_bytes)
            tensor = tensor.to(self.device)
            
            outputs = self.model(tensor)
            probabilities = torch.nn.functional.softmax(outputs, dim=1)[0]
            
            # Get top 3 predictions
            top3_prob, top3_indices = torch.topk(probabilities, 3)
            
            top3_prob = top3_prob.cpu().numpy()
            top3_indices = top3_indices.cpu().numpy()
            
            top_predictions = []
            for i in range(3):
                label = self.classes[top3_indices[i]]
                conf = float(top3_prob[i])
                top_predictions.append({"label": label, "confidence": conf})
                
            best_conf = top_predictions[0]["confidence"]
            best_label = top_predictions[0]["label"]
            
            if best_conf < 0.60:
                return {
                    "label": None,
                    "confidence": best_conf,
                    "status": "uncertain"
                }
                
            return {
                "label": best_label,
                "confidence": best_conf,
                "top_predictions": top_predictions
            }
        except Exception as e:
            raise RuntimeError(f"Inference error: {str(e)}")
