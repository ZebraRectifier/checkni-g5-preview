function defaultImporter() {
  return import("./hybridBasketInterpreter.mjs");
}

function validModule(value) {
  return Boolean(
    value
    && typeof value === "object"
    && typeof value.interpretHybridBasketText === "function"
  );
}

export function createHybridBasketInterpreterLoader(
  importer = defaultImporter
) {
  if (typeof importer !== "function") {
    throw new TypeError("hybrid interpreter importer must be a function");
  }

  let pending = null;
  let loaded = null;

  const load = async () => {
    if (loaded !== null) return loaded;
    if (pending !== null) return pending;

    pending = Promise.resolve()
      .then(() => importer())
      .then((moduleValue) => {
        if (!validModule(moduleValue)) {
          throw new TypeError("hybrid interpreter module is invalid");
        }
        loaded = Object.freeze({
          interpretHybridBasketText:
            moduleValue.interpretHybridBasketText
        });
        pending = null;
        return loaded;
      })
      .catch((error) => {
        pending = null;
        throw error;
      });

    return pending;
  };

  const preload = () => load();

  const isLoaded = () => loaded !== null;

  return Object.freeze({
    isLoaded,
    load,
    preload
  });
}
