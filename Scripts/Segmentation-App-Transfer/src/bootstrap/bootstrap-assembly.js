function assertNonEmptyName(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

/**
 * Coordinates the browser composition root without owning feature behavior.
 *
 * Stages make startup order reviewable. Registered services make the few
 * unavoidable forward callbacks explicit and fail fast if startup order is
 * violated.
 */
export function createBootstrapAssembly(stageNames) {
  if (!Array.isArray(stageNames) || stageNames.length === 0) {
    throw new TypeError("Bootstrap stages must be a non-empty array.");
  }

  const stages = stageNames.map((stageName) => {
    assertNonEmptyName(stageName, "Bootstrap stage");
    return stageName;
  });

  if (new Set(stages).size !== stages.length) {
    throw new Error("Bootstrap stage names must be unique.");
  }

  const services = new Map();
  let stageIndex = -1;
  let completed = false;

  function enter(stageName) {
    if (completed) {
      throw new Error("Bootstrap assembly is already complete.");
    }

    const expectedIndex = stageIndex + 1;
    const expectedStage = stages[expectedIndex];
    if (stageName !== expectedStage) {
      throw new Error(
        `Expected bootstrap stage "${expectedStage}", received "${stageName}".`,
      );
    }

    stageIndex = expectedIndex;
    return stageName;
  }

  function register(serviceName, service) {
    assertNonEmptyName(serviceName, "Bootstrap service");
    if (stageIndex < 0) {
      throw new Error(`Cannot register "${serviceName}" before startup begins.`);
    }
    if (completed) {
      throw new Error("Bootstrap assembly is already complete.");
    }
    if (service == null) {
      throw new TypeError(`Bootstrap service "${serviceName}" is required.`);
    }
    if (services.has(serviceName)) {
      throw new Error(`Bootstrap service "${serviceName}" is already registered.`);
    }

    services.set(serviceName, service);
    return service;
  }

  function resolve(serviceName) {
    assertNonEmptyName(serviceName, "Bootstrap service");
    if (!services.has(serviceName)) {
      throw new Error(`Bootstrap service "${serviceName}" is not ready.`);
    }
    return services.get(serviceName);
  }

  function method(serviceName, methodName) {
    assertNonEmptyName(serviceName, "Bootstrap service");
    assertNonEmptyName(methodName, "Bootstrap method");

    return (...args) => {
      const service = resolve(serviceName);
      const serviceMethod = service[methodName];
      if (typeof serviceMethod !== "function") {
        throw new TypeError(
          `Bootstrap service "${serviceName}" does not provide "${methodName}()".`,
        );
      }
      return Reflect.apply(serviceMethod, service, args);
    };
  }

  function complete(requiredServices = []) {
    if (stageIndex !== stages.length - 1) {
      throw new Error(
        `Cannot complete bootstrap before stage "${stages[stages.length - 1]}".`,
      );
    }

    requiredServices.forEach(resolve);
    completed = true;
  }

  return Object.freeze({
    enter,
    register,
    resolve,
    method,
    complete,
    get currentStage() {
      return stages[stageIndex] || null;
    },
    get isComplete() {
      return completed;
    },
  });
}
