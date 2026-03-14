const RESEARCH_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'webseach',
      description: 'Run web search using Jina AI for one or more research queries.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Single research query.',
          },
          queries: {
            type: 'array',
            description: 'Multiple research queries that can be executed in parallel.',
            items: {
              type: 'string',
            },
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'webfetch',
      description: 'Fetch and return markdown content for a URL using Jina AI.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Absolute URL to fetch.',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'message',
      description: 'Send a progress update to the user.',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Progress update for the user.',
          },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'summary',
      description: 'End the loop by returning final markdown summary to the user.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Final markdown summary.',
          },
        },
        required: ['summary'],
      },
    },
  },
]

module.exports = {
  RESEARCH_TOOLS,
}
