FROM python:3.11-slim
# OpenCV (pulled in by fast-alpr) needs these shared libraries at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py plate_reader.py ./
# Download the pretrained models at build time so the first scan is not slow.
RUN python -c "import app"
EXPOSE 8090
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090"]
