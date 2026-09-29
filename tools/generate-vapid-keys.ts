import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
process.stdout.write(
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`,
);
