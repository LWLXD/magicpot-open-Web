import { describe, expect, it } from 'vitest'
import { convertGuiWorkflowToPrompt } from './guiWorkflowToPrompt'

describe('convertGuiWorkflowToPrompt', () => {
  it('does not carry Note nodes from GUI workflow exports into executable prompts', () => {
    const workflow = convertGuiWorkflowToPrompt({
      nodes: [
        {
          id: 1,
          type: 'LoadImage',
          title: 'Load Image',
          inputs: [],
          outputs: [],
          widgets_values: ['input.png'],
          properties: {
            widget_ue_connectable: {
              image: {}
            }
          }
        },
        {
          id: 18,
          type: 'Note',
          inputs: [],
          outputs: [],
          widgets_values: ['Enable to upscale alpha/mask channel along with RGB channel.']
        },
        {
          id: 5,
          type: 'SaveImage',
          title: 'Save Image',
          inputs: [{ name: 'images', link: 1 }],
          outputs: []
        }
      ],
      links: [[1, 1, 0, 5, 0, 'IMAGE']]
    })

    expect(workflow).toEqual({
      '1': {
        class_type: 'LoadImage',
        inputs: {
          image: 'input.png'
        },
        _meta: {
          title: 'Load Image'
        }
      },
      '5': {
        class_type: 'SaveImage',
        inputs: {
          images: ['1', 0]
        },
        _meta: {
          title: 'Save Image'
        }
      }
    })
  })

  it('resolves links through reroute nodes before omitting them', () => {
    const prompt = convertGuiWorkflowToPrompt({
      nodes: [
        {
          id: 1,
          type: 'LoadImage',
          title: 'Load Image',
          outputs: [{}]
        },
        {
          id: 2,
          type: 'Reroute',
          title: 'Reroute',
          inputs: [{ name: '', link: 10 }],
          outputs: [{}]
        },
        {
          id: 3,
          type: 'PreviewImage',
          title: 'Preview Image',
          inputs: [{ name: 'images', link: 11 }]
        }
      ],
      links: [
        [10, 1, 0, 2, 0, 'IMAGE'],
        [11, 2, 0, 3, 0, 'IMAGE']
      ]
    })

    expect(prompt?.['2']).toBeUndefined()
    expect(prompt?.['3'].inputs.images).toEqual(['1', 0])
  })
})
