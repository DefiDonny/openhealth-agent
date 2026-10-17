FROM node:lts-alpine
LABEL authors="OpenHealth"

RUN apk add -U graphicsmagick ghostscript

WORKDIR /app

COPY package.json prisma/ .

RUN npm ci

COPY . .

# Fix LangChain ChatAnthropic sending top_p:-1 to Anthropic API
RUN sed -i "s/top_p: this\.topP,/top_p: this.topP === -1 ? undefined : this.topP,/g" node_modules/@langchain/anthropic/dist/chat_models.js &&     sed -i "s/top_k: this\.topK,/top_k: this.topK === -1 ? undefined : this.topK,/g" node_modules/@langchain/anthropic/dist/chat_models.js

RUN npm run build &&     adduser --disabled-password ohuser &&     chown -R ohuser .

USER ohuser
EXPOSE 3000
ENTRYPOINT ["sh", "-c", "npx prisma db push --accept-data-loss && npx prisma db seed && npm start"]
