# Röstrecensioner – MVP v0.2 (Rollback-basen)

Detta är den **fungerande** versionen: start/stop-ikon, live vågform, lokala recensioner.
Ingen “Kenai”-branding.

## Strukturen
```
public/
  index.html   <- redigera denna fil för UI
server.js      <- statisk server för Render Web Service (Node)
package.json   <- start: node server.js
render.yaml    <- (valfritt) Render blueprint
```

## Deploy på Render (Web Service – Node)
- Environment: **Node**
- Build command: `npm install`
- Start command: `node server.js`
- Deploys → **Manual Deploy → Clear build cache & deploy**

## Alternativ: Render Static Site (ingen server)
- New → **Static Site**
- Publish directory: `public`
- Build command: (tom)

## Testa lokalt
```bash
npm i
npm start
# öppna http://localhost:3000
```

## Rollback
Spara denna version som **MVP v0.2**. Om framtida ändringar strular, lägg tillbaka dessa filer oförändrade.
