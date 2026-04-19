import type {} from "mocha";

const assert = require("node:assert/strict");
const ReactLib = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { RemiIdentityAvatar } = require("../src/components/RemiIdentityAvatar");

describe("RemiIdentityAvatar", () => {
  it("renders the selected remi portrait asset", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(RemiIdentityAvatar, {
        className: "size-11",
      }),
    );

    assert.ok(markup.includes('/avatar/assets/remi-selected-portrait.png'));
    assert.ok(markup.includes('alt="Remi avatar"'));
    assert.ok(markup.includes("size-11"));
  });
});
