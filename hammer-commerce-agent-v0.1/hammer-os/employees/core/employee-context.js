export class EmployeeContext {
  constructor({ workspace, messageBus, knowledgeCenter, toolGateway } = {}) {
    if (!workspace || !messageBus || !knowledgeCenter || !toolGateway) throw new Error("EmployeeContext 依赖不完整");
    Object.defineProperties(this, {
      workspace: { value: workspace, enumerable: true },
      communication: { value: messageBus, enumerable: true },
      knowledge: { value: knowledgeCenter, enumerable: true },
      tools: { value: toolGateway, enumerable: true },
    });
    Object.freeze(this);
  }
}
