# Snipp – Deploy-guide (Render)

## 1) Förbered GitHub
- Lägg upp allt i ett nytt repo (t.ex. snipp-deploy-sv).
- `.env` pushas inte (den finns i `.gitignore`).

## 2) Render
- https://render.com → New → Web Service → Connect repo.
- Build: `npm install`
- Start: `npm start`
- Lägg **Environment Variables**:
  - `OPENAI_API_KEY` = `sk-proj-...`
  - (valfritt) `ALLOWED_ORIGIN` = `https://din-domän.se`
- Lägg till **Disk** om du vill spara historik över restarts:
  - Name: `texts`, Mount path: `/opt/render/project/src/texts`, Size: 1GB

## 3) Lokalt
```bash
npm install
npm run test:api
npm start
# http://localhost:3000
```

## 4) Docker (lokalt)
```bash
docker build -t snipp-sv .
docker run -p 3000:3000 -e OPENAI_API_KEY=sk-proj-... snipp-sv
```
