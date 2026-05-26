import { describe, expect, it } from 'vitest'
import { convertGuiWorkflowToPrompt } from './guiWorkflowToPrompt'

describe('convertGuiWorkflowToPrompt', () => {
  it('omits frontend-only note nodes from the backend prompt', () => {
    const prompt = convertGuiWorkflowToPrompt({
      nodes: [
        {
          id: 18,
          type: 'Note',
          title: 'Note',
          widgets_values: ['Helpful canvas-only comment']
        },
        {
          id: 15,
          type: 'SaveImage',
          title: 'Save Image',
          inputs: [{ name: 'filename_prefix', widget: { name: 'filename_prefix' } }],
          widgets_values: ['ComfyUI']
        }
      ],
      links: []
    })

    expect(prompt).toEqual({
      '15': {
        class_type: 'SaveImage',
        inputs: {
          filename_prefix: 'ComfyUI'
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
