import path from "node:path";
import { MatchersV3, PactV4 } from "@pact-foundation/pact";
import { createApiClient } from "./client";

// Rename the participants when you create a product repo from this template: consumer is this app,
// provider is the API repo whose CI verifies this pact (see its PactProviderTest).
const pact = new PactV4({
  consumer: "template-web",
  provider: "template-service",
  dir: path.resolve(process.cwd(), "pacts"),
});

describe("greetings API contract", () => {
  it("returns a greeting for a name", () =>
    pact
      .addInteraction()
      .given("greetings are available")
      .uponReceiving("a request for a greeting")
      .withRequest("GET", "/api/v1/greetings", (b) =>
        b.query({ name: "Ada" }).headers({ Accept: "application/json" }),
      )
      .willRespondWith(200, (b) =>
        b
          .jsonBody({ message: MatchersV3.string("Hello, Ada!") })
          .headers({ "Content-Type": "application/json" }),
      )
      .executeTest(async (server) => {
        const greeting = await createApiClient(server.url).greeting("Ada");
        expect(greeting.message).toBe("Hello, Ada!");
      }));
});
