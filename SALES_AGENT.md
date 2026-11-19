# Agente comercial CompuApps SecureDev

La implementación inicial incluye CRM gratuito basado en archivos JSON, catálogo comercial, calificación de prospectos, cola de correos y reporte diario PDF.

## Configuración

1. Crear credenciales OAuth de Gmail en Google Cloud.
2. Configurar los secretos manualmente en el servidor.
3. No compartir secretos en el repositorio ni en variables públicas Vite.
4. Conectar Gmail solo con una cuenta autorizada.

## Límites

- Máximo 10 correos enviados por día.
- Sin envío a prospectos opt-out o bloqueados.
- Pentesting requiere autorización escrita.
- Vega Cam requiere validar privacidad y reconocimiento facial.
- Precios y contratos requieren confirmación humana.

## Próximos pasos

- Gmail API para enviar y recibir respuestas.
- Watch/PubSub o polling para respuestas.
- Generación de PDF diario.
- Firestore como opción de persistencia en producción.
