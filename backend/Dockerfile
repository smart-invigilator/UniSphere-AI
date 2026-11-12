FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libsm6 libxext6 libxrender1 libgl1 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH PYTHONUNBUFFERED=1
WORKDIR /home/user/app

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir -r requirements.txt

COPY --chown=user . .
RUN mkdir -p media/questions media/answers

EXPOSE 7860
CMD ["sh", "-c", "alembic upgrade head && python -m app.seed && uvicorn app.main:socket_app --host 0.0.0.0 --port 7860 --proxy-headers --forwarded-allow-ips='*'"]
