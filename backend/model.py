from ultralytics import YOLO

# Load a YOLO26 model
model = YOLO("yolo26n.pt")

# Export the model to ONNX format
model.export(format="onnx")  # creates 'yolo26n.onnx'

# Export an INT8-quantized ONNX model with calibration data
model.export(format="onnx", quantize=8, data="coco8.yaml")  # creates 'yolo26n_int8.onnx'
