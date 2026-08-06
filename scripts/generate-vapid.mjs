import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();

console.log(`
Add these to your .env file:

VAPID_PUBLIC_KEY=${keys.publicKey}
VAPID_PRIVATE_KEY=${keys.privateKey}
VAPID_SUBJECT=mailto:you@example.com
`);
