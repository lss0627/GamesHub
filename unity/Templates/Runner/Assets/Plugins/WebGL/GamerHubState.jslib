mergeInto(LibraryManager.library, {
  GamerHubCreativeState: function (pointer) {
    window.__gamerhubCreativeState = Object.freeze(JSON.parse(UTF8ToString(pointer)));
  },
  GamerHubState: function (pointer) {
    window.__gamerhubGameState = Object.freeze(JSON.parse(UTF8ToString(pointer)));
  }
});
