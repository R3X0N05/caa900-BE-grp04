import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, GetCommand, PutCommand, DeleteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocumentClient.from(client);
const TABLE = "Products";
const H = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

function decodeJWT(event) {
  try {
    const token = (event.headers?.Authorization || event.headers?.authorization || "").replace("Bearer ", "");
    if (!token) return null;
    return JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
  } catch { return null; }
}

export const handler = async (event) => {
  const method = event.httpMethod;
  const path   = event.path;
  const id     = event.pathParameters?.id;
  const body   = event.body ? JSON.parse(event.body) : {};

  try {

    if (method === "OPTIONS") {
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type,Authorization",
          "Access-Control-Allow-Methods": "GET,PUT,DELETE,POST,OPTIONS"
        },
        body: ""
      };
    }

    // GET /products
    if (method === "GET" && path === "/products") {
      const { Items } = await db.send(new ScanCommand({ TableName: TABLE }));
      return { statusCode: 200, headers: H, body: JSON.stringify({ products: Items }) };
    }

    // GET /admin/products
    if (method === "GET" && path === "/admin/products") {
      const { Items } = await db.send(new ScanCommand({ TableName: TABLE }));
      return { statusCode: 200, headers: H, body: JSON.stringify({ products: Items }) };
    }

    // GET /product/{id}
    if (method === "GET" && path.startsWith("/product/") && id) {
      const { Item } = await db.send(new GetCommand({ TableName: TABLE, Key: { productId: id } }));
      if (!Item) return { statusCode: 404, headers: H, body: JSON.stringify({ message: "Product not found" }) };
      return { statusCode: 200, headers: H, body: JSON.stringify({ product: Item }) };
    }

    // GET /admin/product/{id}
    if (method === "GET" && path.startsWith("/admin/product/") && id) {
      const { Item } = await db.send(new GetCommand({ TableName: TABLE, Key: { productId: id } }));
      if (!Item) return { statusCode: 404, headers: H, body: JSON.stringify({ message: "Product not found" }) };
      return { statusCode: 200, headers: H, body: JSON.stringify({ product: Item }) };
    }

    // PUT /admin/product/{id} — update product fields (name, price, featured, etc.)
    if (method === "PUT" && path.startsWith("/admin/product/") && id) {
      const updates = [];
      const values  = {};
      const names   = {};

      if (body.featured  !== undefined) { updates.push("#featured = :featured");   names["#featured"]  = "featured";    values[":featured"]  = body.featured; }
      if (body.name      !== undefined) { updates.push("#name = :name");           names["#name"]      = "name";        values[":name"]      = body.name; }
      if (body.price     !== undefined) { updates.push("price = :price");                                               values[":price"]     = body.price; }
      if (body.description !== undefined) { updates.push("description = :desc");                                        values[":desc"]      = body.description; }
      if (body.category  !== undefined) { updates.push("category = :category");                                         values[":category"]  = body.category; }
      if (body.Stock     !== undefined) { updates.push("Stock = :stock");                                               values[":stock"]     = body.Stock; }
      if (body.image     !== undefined) { updates.push("image = :image");                                               values[":image"]     = body.image; }

      if (updates.length === 0) return { statusCode: 400, headers: H, body: JSON.stringify({ message: "No fields to update" }) };

      await db.send(new UpdateCommand({
        TableName: TABLE,
        Key: { productId: id },
        UpdateExpression: `SET ${updates.join(", ")}`,
        ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
        ExpressionAttributeValues: values
      }));

      const { Item } = await db.send(new GetCommand({ TableName: TABLE, Key: { productId: id } }));
      return { statusCode: 200, headers: H, body: JSON.stringify({ product: Item }) };
    }

    // GET /reviews?id={productId}
    if (method === "GET" && path === "/reviews") {
      const pid = event.queryStringParameters?.id;
      if (!pid) return { statusCode: 400, headers: H, body: JSON.stringify({ message: "Missing product id" }) };
      const { Item } = await db.send(new GetCommand({ TableName: TABLE, Key: { productId: pid } }));
      if (!Item) return { statusCode: 404, headers: H, body: JSON.stringify({ message: "Product not found" }) };
      return { statusCode: 200, headers: H, body: JSON.stringify({ reviews: Item.reviews || [] }) };
    }

    // PUT /review
    if (method === "PUT" && path === "/review") {
      const payload = decodeJWT(event);
      if (!payload) return { statusCode: 401, headers: H, body: JSON.stringify({ message: "Unauthorized" }) };

      const { productId, rating, comment } = body;
      if (!productId || !rating) return { statusCode: 400, headers: H, body: JSON.stringify({ message: "productId and rating are required" }) };

      const { Items: orders } = await db.send(new ScanCommand({
        TableName: "Orders",
        FilterExpression: "userEmail = :e",
        ExpressionAttributeValues: { ":e": payload.email }
      }));
      const hasBought = (orders || []).some(o =>
        (o.orderItems || []).some(i => i.productId === productId)
      );
      if (!hasBought) return { statusCode: 403, headers: H, body: JSON.stringify({ message: "You can only review products you have purchased" }) };

      const { Item: product } = await db.send(new GetCommand({ TableName: TABLE, Key: { productId } }));
      const alreadyReviewed = (product?.reviews || []).find(r => r.userId === payload.sub);
      if (alreadyReviewed) return { statusCode: 409, headers: H, body: JSON.stringify({ message: "You have already reviewed this product" }) };

      const review = {
        _id: crypto.randomUUID(),
        userId: payload.sub,
        userEmail: payload.email,
        userName: payload.name || payload.email,
        rating: Number(rating),
        comment: comment || "",
        createdAt: new Date().toISOString()
      };
      const reviews = [...(product?.reviews || []), review];
      const avgRating = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;

      await db.send(new UpdateCommand({
        TableName: TABLE,
        Key: { productId },
        UpdateExpression: "SET reviews = :r, numOfReviews = :n, avgRating = :a",
        ExpressionAttributeValues: {
          ":r": reviews,
          ":n": reviews.length,
          ":a": Math.round(avgRating * 10) / 10
        }
      }));
      return { statusCode: 201, headers: H, body: JSON.stringify({ review }) };
    }

    // DELETE /review
    if (method === "DELETE" && path === "/review") {
      const payload = decodeJWT(event);
      if (!payload || payload["custom:role"] !== "admin") return { statusCode: 403, headers: H, body: JSON.stringify({ message: "Admin only" }) };

      const { reviewId, productId } = body;
      if (!reviewId || !productId) return { statusCode: 400, headers: H, body: JSON.stringify({ message: "reviewId and productId required" }) };

      const { Item: product } = await db.send(new GetCommand({ TableName: TABLE, Key: { productId } }));
      if (!product) return { statusCode: 404, headers: H, body: JSON.stringify({ message: "Product not found" }) };

      const reviews = (product.reviews || []).filter(r => r._id !== reviewId);
      const avgRating = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;

      await db.send(new UpdateCommand({
        TableName: TABLE,
        Key: { productId },
        UpdateExpression: "SET reviews = :r, numOfReviews = :n, avgRating = :a",
        ExpressionAttributeValues: {
          ":r": reviews,
          ":n": reviews.length,
          ":a": Math.round(avgRating * 10) / 10
        }
      }));
      return { statusCode: 200, headers: H, body: JSON.stringify({ success: true }) };
    }

    // POST /admin/product/new
    if (method === "POST" && path === "/admin/product/new") {
      const item = { ...body, productId: body.productId || crypto.randomUUID(), createdAt: new Date().toISOString() };
      await db.send(new PutCommand({ TableName: TABLE, Item: item }));
      return { statusCode: 201, headers: H, body: JSON.stringify({ product: item }) };
    }

    // DELETE /admin/product/{id}
    if (method === "DELETE" && path.startsWith("/admin/product/") && id) {
      await db.send(new DeleteCommand({ TableName: TABLE, Key: { productId: id } }));
      return { statusCode: 200, headers: H, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 404, headers: H, body: JSON.stringify({ message: "Not found", method, path }) };

  } catch (err) {
    console.error("ERROR:", err.message);
    return { statusCode: 500, headers: H, body: JSON.stringify({ message: err.message }) };
  }
};