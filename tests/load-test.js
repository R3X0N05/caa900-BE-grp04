import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 10,
  duration: "30s",
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<2000"],
  },
};

export default function () {
  const res = http.get(
    "https://9ok7xa70r0.execute-api.us-east-1.amazonaws.com/prod/products"
  );
  check(res, { "status 200": (r) => r.status === 200 });
  sleep(1);
}
