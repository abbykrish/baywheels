FROM node:20-slim

# Install CA certs for TLS connections (needed by MotherDuck)
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install backend deps
COPY backend/package*.json backend/
RUN cd backend && npm ci

# Install frontend deps and build
COPY frontend/package*.json frontend/
RUN cd frontend && npm ci
COPY frontend/ frontend/
RUN cd frontend && npm run build

# Copy backend source
COPY backend/ backend/
COPY package.json .

EXPOSE 8080

CMD ["npm", "run", "start"]
