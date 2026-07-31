import { CognitoIdentityProviderClient, ListUsersCommand,
  AdminGetUserCommand, AdminUpdateUserAttributesCommand,
  AdminDeleteUserCommand } from "@aws-sdk/client-cognito-identity-provider";

const cognito   = new CognitoIdentityProviderClient({ region: "us-east-1" });
const USER_POOL = "us-east-1_Lw2Xpo4ll";
const H         = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

function parseJwt(token) {
  try {
    if (!token) return {};
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  } catch { return {}; }
}

function formatUser(u) {
  const attrs = {};
  (u.Attributes || u.UserAttributes || []).forEach(a => attrs[a.Name] = a.Value);
  return {
    userId:    u.Username,
    name:      attrs.name || attrs["cognito:username"] || u.Username,
    email:     attrs.email || "",
    role:      attrs["custom:role"] || "user",
    status:    u.UserStatus,
    createdAt: u.UserCreateDate,
  };
}

export const handler = async (event) => {
  const method = event.httpMethod;
  const path   = event.resource;
  const id     = event.pathParameters?.id;
  const body   = event.body ? JSON.parse(event.body) : {};

  const authHeader = event.headers?.Authorization || event.headers?.authorization || "";
  const claims = event.requestContext?.authorizer?.claims || parseJwt(authHeader);
  const role   = claims?.["custom:role"] || claims?.role;

  if (role !== "admin") return { statusCode: 403, headers: H, body: JSON.stringify({ message: "Forbidden" }) };

  try {

    // GET /admin/users
    if (method === "GET" && path === "/admin/users") {
      const data = await cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL }));
      return { statusCode: 200, headers: H, body: JSON.stringify({ users: data.Users.map(formatUser) }) };
    }

    // GET /admin/user/{id}
    if (method === "GET" && path === "/admin/user/{id}" && id) {
      const data = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL, Username: id }));
      return { statusCode: 200, headers: H, body: JSON.stringify({ user: formatUser(data) }) };
    }

    // PUT /admin/user/{id}
    if (method === "PUT" && path === "/admin/user/{id}" && id) {
      const attrs = [];
      if (body.name) attrs.push({ Name: "name",        Value: body.name });
      if (body.role) attrs.push({ Name: "custom:role", Value: body.role });
      await cognito.send(new AdminUpdateUserAttributesCommand({
        UserPoolId: USER_POOL, Username: id, UserAttributes: attrs
      }));
      return { statusCode: 200, headers: H, body: JSON.stringify({ success: true }) };
    }

    // DELETE /admin/user/{id}
    if (method === "DELETE" && path === "/admin/user/{id}" && id) {
      await cognito.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL, Username: id }));
      return { statusCode: 200, headers: H, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 404, headers: H, body: JSON.stringify({ message: "Not found" }) };

  } catch (err) {
    return { statusCode: 500, headers: H, body: JSON.stringify({ message: err.message }) };
  }
};
