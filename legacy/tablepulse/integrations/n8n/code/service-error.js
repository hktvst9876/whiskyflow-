// Do not echo node errors, request headers, signatures or credential details.
return [
  {
    json: {
      statusCode: 503,
      response: {
        ok: false,
        error: {
          code: "INTEGRATION_UNAVAILABLE",
          message:
            "The integration could not confirm processing. Retry later with the same externalId and order.",
          retryable: true,
        },
      },
    },
  },
];
