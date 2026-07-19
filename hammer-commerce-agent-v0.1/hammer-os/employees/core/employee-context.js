export class EmployeeContext {
  constructor({ workspace, messageBus, knowledgeCenter } = {}) {
    if (!workspace || !messageBus || !knowledgeCenter) throw new Error("EmployeeContext 依赖不完整");
    Object.defineProperties(this, {
      workspace: { value: workspace, enumerable: true },
      communication: { value: messageBus, enumerable: true },
      knowledge: { value: knowledgeCenter, enumerable: true },
    });
    Object.freeze(this);
  }
}
