import Stripe from "stripe";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const sm = new SecretsManagerClient({ region: "us-east-1" });
const H  = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

let _secrets = null;
async function getSecrets() {
  if (_secrets) return _secrets;
  const resp = await sm.send(new GetSecretValueCommand({ SecretId: "rexony/backend" }));
  _secrets = JSON.parse(resp.SecretString);
  return _secrets;
}

export const handler = async (event) => {
  try {
    const { STRIPE_SECRET_KEY } = await getSecrets();
    const stripe = new Stripe(STRIPE_SECRET_KEY);
    const body   = event.body ? JSON.parse(event.body) : {};

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: body.email,
      line_items: body.items.map(item => ({
        price_data: {
          currency: "usd",
          product_data: { name: item.name },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.quantity,
      })),
      success_url: "https://main.dijcvcdvudbc2.amplifyapp.com?payment=success",
      cancel_url:  "https://main.dijcvcdvudbc2.amplifyapp.com?payment=cancelled",
    });

    return { statusCode: 200, headers: H, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    return { statusCode: 500, headers: H, body: JSON.stringify({ message: err.message }) };
  }
};
