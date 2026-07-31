import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({ region: "us-east-1" });

export const handler = async (event) => {

  for (const record of event.Records) {

    if (record.eventName !== "INSERT") {
      continue;
    }

    const order = record.dynamodb.NewImage;

    const email         = order.userEmail.S;
    const orderId       = order.orderId.S;
    const totalPrice    = Number(order.totalPrice.N).toFixed(2);
    const shippingPrice = Number(order.shippingPrice.N).toFixed(2);
    const taxPrice      = Number(order.taxPrice.N).toFixed(2);
    const itemsPrice    = Number(order.itemsPrice.N).toFixed(2);
    const createdAt     = order.createdAt.S;

    const items = order.orderItems.L.map(item => {
      const product = item.M;
      return `
        <tr>
          <td>${product.name.S}</td>
          <td>${product.quantity.N}</td>
          <td>$${Number(product.price.N).toFixed(2)}</td>
        </tr>
      `;
    }).join("");

    const htmlBody = `
      <html>
      <body style="font-family: Arial, sans-serif;">
        <h2>Thank you for your order!</h2>
        <p>We've successfully received your order.</p>
        <h3>Order Details</h3>
        <table border="1" cellpadding="8" cellspacing="0">
          <tr><td><strong>Order ID</strong></td><td>${orderId}</td></tr>
          <tr><td><strong>Order Date</strong></td><td>${new Date(createdAt).toLocaleString()}</td></tr>
        </table>
        <br>
        <h3>Items Purchased</h3>
        <table border="1" cellpadding="8" cellspacing="0">
          <tr><th>Product</th><th>Quantity</th><th>Price</th></tr>
          ${items}
        </table>
        <br>
        <table>
          <tr><td>Items:</td><td>$${itemsPrice}</td></tr>
          <tr><td>Shipping:</td><td>$${shippingPrice}</td></tr>
          <tr><td>Tax:</td><td>$${taxPrice}</td></tr>
          <tr><td><strong>Total</strong></td><td><strong>$${totalPrice}</strong></td></tr>
        </table>
        <br>
        <p>We'll notify you when your order ships.</p>
        <p>Thank you for shopping with us!</p>
      </body>
      </html>
    `;

    const textBody = `
Thank you for your order!

Order ID: ${orderId}

Items Price: $${itemsPrice}
Shipping: $${shippingPrice}
Tax: $${taxPrice}
Total: $${totalPrice}

Thank you for shopping with us!
    `;

    const command = new SendEmailCommand({
      Source: process.env.FROM_EMAIL,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: `Order Confirmation - ${orderId}` },
        Body: {
          Html: { Data: htmlBody },
          Text: { Data: textBody }
        }
      }
    });

    const response = await ses.send(command);
    console.log("SES Response:", JSON.stringify(response, null, 2));
    console.log(`Email successfully sent to ${email}`);
  }

  return { statusCode: 200 };
};