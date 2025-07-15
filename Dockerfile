# Usamos una imagen oficial de Node.js que es ligera y compatible.
FROM node:18-slim

# Establecemos el directorio de trabajo dentro del contenedor.
WORKDIR /usr/src/app

# Copiamos los archivos de dependencias primero para aprovechar el caché de Docker.
COPY package*.json ./

# ¡EL PASO CLAVE! Instalamos las dependencias de npm y luego las de Playwright.
# Dentro de Docker, este comando SÍ tiene los permisos necesarios.
RUN npm install && npx playwright install --with-deps

# Copiamos el resto del código de nuestra aplicación.
COPY . .

# El comando final que se ejecutará cuando el contenedor arranque.
CMD [ "node", "index.js" ]