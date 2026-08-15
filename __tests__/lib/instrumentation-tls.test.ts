import https from "node:https";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { register } from "@/instrumentation";

const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCo2BI8jpqyZUK47ET7wvJcasFf
Lazc+0gzxd8aKWEtKqMwu8/xfJAsYOOsq9vdhLtI0Ejy9P7oKezh7fibRGNuf/Mlb+6tMTFpe3tO
nvBcknivUvtpm9jaaBiwpK+tUmlWSG1+/HdrOdMMiYIpbMVIlAAktLPK/xu9WjmZogfkRx9fDa7S
obCGrBjlA/5FF1piqiokvZJZFljIglBOgGRG28syIwsQbFaWOki80H7jhbrWpugKdGNL0z6kb3CC
0GxDukmvIQ9eUMh38KsIQx/n/EN5Po7keWIjIbxB4E7+hhoe4cLBFwWgM1DNNFELrR8vJ5eh6LIO
RV1JUclWctvlAgMBAAECggEAZDaqzEqPwuabLYr+frd8hiHO2CESAq8acbA19R8uUFKIPXqbt2cJ
Y222dFwkyVvolRUa1ylWypFnyckmz3FN2t4SgNvou98AxuzFiSqI20kMXHNSSaJ4mVlDnkSBCMxr
PQ0MAFz0vC27+Cr9mHy4s5U0aJTgSdIUstSEb41eRbyBi+Iq80k7FcZJ4PRbPN5rL9GaR1ATV/bJ
Ivd5tbR6KPXuz6bKj2Ylh5ZMiseSVhBoLmEC4xVFUlSiTeSxIIwO1zziArbABvwdRVHfnrrurcy2
VpdGa5sGcchXHp+zvlHaijwj9MYMD2y873aVEzWOyBvb4R9H8e2fxY0TOBsDWQKBgQDfpBKm17iq
wtfz8/81ii14F3FL7+1ffdNASEGvPKMlK9sM6oEUVR890wMC0zrCVo/xkQ3QoAynGubF6LJWpJwA
kEAlRruWhYG4nfEFkyRD2evQkrYfTW0oDt7NsRK1NPhlY0fqeK8NxgWMVYHDizHyLFKqLRcZIvuz
2Dj8eNiZzwKBgQDBRkGajLLG4WVlbiDA4Iw+oMzk8IXxpggUlITVXsxwT6PANEykaUsXA4DZ8gjZ
fAcvg5YORFnb6mlrl/TCVA4fGWWt5OWNgDXSJhxO74DHwNs0gEZnzhxWbRdD+LrXcOEqITZEryqw
zcmY81mzkc/quety6z+ahFh8J5P4mOfACwKBgF5e9vvuld+A/u3TrYLjPxKpGccIhKtCBk3e79DJ
jrKV0gaeQj/ZN6i4DVI43le5fV5bbm/1ycEOKgmjivXi2m2mcVsJgQkgZ0AHbfiDQc9b+xV1g2Ks
In6/36b+rL1Ij/UAsw0vRfdS825neq2QZFAkAfILuu6Bg6M9f7aSLByjAoGBAKGaqxQc/QcKRAwR
j1V27A0ZyvjKnFS3rR34KTF3uJ1YGeWGVWdLmzu89CpIFFo1OJTkA74eLLyTPl52inNKcRxT0g8a
y04Lm/UBZL4jyJw9h4xYjYYScuNZCBEPkrq9aageaQ/5H0sCZsR7Bc/95cmwd0x5o48BhjMZrMI6
p9yNAoGAYb2aMk5dOhqbSsc5x3vzpCd8up5Y1wDWcGfITeONAsHCD7Uw5NLu10UHbtrzwCGgDRo8
ZUYVnrR0+eQqaeYysXavL/whX205MZYamAfb5KPJC/al3737fWFITujMULYVLteFiVrNJnQ2VGFp
mO9xJhv76u1DFemKAXQSrjgVWlM=
-----END PRIVATE KEY-----`;

const TEST_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIICwzCCAaugAwIBAgIJAMJdIOpuyOisMA0GCSqGSIb3DQEBCwUAMBQxEjAQBgNVBAMTCWxvY2Fs
aG9zdDAeFw0yNjA4MTQyMDA5NTdaFw0zNjA4MTUyMDA5NTdaMBQxEjAQBgNVBAMTCWxvY2FsaG9z
dDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAKjYEjyOmrJlQrjsRPvC8lxqwV8trNz7
SDPF3xopYS0qozC7z/F8kCxg46yr292Eu0jQSPL0/ugp7OHt+JtEY25/8yVv7q0xMWl7e06e8FyS
eK9S+2mb2NpoGLCkr61SaVZIbX78d2s50wyJgilsxUiUACS0s8r/G71aOZmiB+RHH18NrtKhsIas
GOUD/kUXWmKqKiS9klkWWMiCUE6AZEbbyzIjCxBsVpY6SLzQfuOFutam6Ap0Y0vTPqRvcILQbEO6
Sa8hD15QyHfwqwhDH+f8Q3k+juR5YiMhvEHgTv6GGh7hwsEXBaAzUM00UQutHy8nl6Hosg5FXUlR
yVZy2+UCAwEAAaMYMBYwFAYDVR0RBA0wC4IJbG9jYWxob3N0MA0GCSqGSIb3DQEBCwUAA4IBAQAb
B2xvSJkSV0uGxuKNxoiUJeCCIap4gvyhbGj4fnoMQspdAfFuCBoMjjYOgdK3pM7EV9ORjzIzE/Ph
fFp4bsRhUC98G5CH+ZoxCCVaZ1RllQLazD8Ols8q5FsChrcjf4+QGFdA0YzVc6VO/RyL0MX+OV6R
8dtwNGZIi2A0Oq9dkFDWIilWxnbkXoAttpWq6lFInlGQr+EjbrlkScQiKMREkaRnchQMXcDNUFji
1TAHKpSQeuicEYUku/T2p7HuAIhgOYR7QY616Mo/K0D2J9ENyNCE+SCGJQpbP576GBz3tgMR1vHW
oXfp6YEe8JJ4NQZoiwC51CHbd5Vn7CdU5Asb
-----END CERTIFICATE-----`;

const originalTlsPolicy = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

afterEach(() => {
  if (originalTlsPolicy === undefined) {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  } else {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsPolicy;
  }
});

describe("server instrumentation TLS policy", () => {
  it("SEC-TLS-001 rejects a self-signed HTTPS certificate after registration", async () => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    register();

    const server = https.createServer(
      { key: TEST_PRIVATE_KEY, cert: TEST_CERTIFICATE },
      (_request, response) => response.end("ok"),
    );

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, resolve);
    });

    try {
      const { port } = server.address() as AddressInfo;
      const request = new Promise<void>((resolve, reject) => {
        https
          .get(`https://localhost:${port}`, (response) => {
            response.resume();
            resolve();
          })
          .once("error", reject);
      });

      await expect(request).rejects.toMatchObject({
        code: "DEPTH_ZERO_SELF_SIGNED_CERT",
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }

    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it("does not override an explicit process TLS policy", () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";

    register();

    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe("1");
  });
});
