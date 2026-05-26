import React, { useCallback, useEffect, useState } from 'react'
import { InputProps } from './InputProps'
import { Box, IconButton, Typography, Button } from '@mui/material'
import { UploadOutlined, PhotoLibraryOutlined } from '@mui/icons-material'
import { api } from '@renderer/utils/windowUtils'
import { FileItem } from '@shared/comfy/types'
import BaseInputComfyImage from './BaseInputComfyImage'
import { fileItemToValue, valueToFileItem } from '@shared/comfy/funcs'
import { useMessage } from '@renderer/hooks/useMessage'
import { useTranslation } from 'react-i18next'

type InputComfyImageProps = InputProps<string> & {
  placeholder: string
}

const isLikelyImageBytes = (bytes: Uint8Array): boolean => {
  if (bytes.length < 4) return false
  const startsWith = (...signature: number[]) =>
    signature.every((value, index) => bytes[index] === value)

  return (
    startsWith(0x89, 0x50, 0x4e, 0x47) ||
    startsWith(0xff, 0xd8, 0xff) ||
    startsWith(0x47, 0x49, 0x46, 0x38) ||
    startsWith(0x42, 0x4d) ||
    startsWith(0x49, 0x49, 0x2a, 0x00) ||
    startsWith(0x4d, 0x4d, 0x00, 0x2a) ||
    (bytes.length >= 12 &&
      startsWith(0x52, 0x49, 0x46, 0x46) &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50) ||
    (bytes.length >= 12 &&
      bytes[4] === 0x66 &&
      bytes[5] === 0x74 &&
      bytes[6] === 0x79 &&
      bytes[7] === 0x70)
  )
}

const InputComfyImage: React.FC<InputComfyImageProps> = ({
  value,
  label,
  onChange,
  placeholder,
  Icon
}) => {
  const [internalValue, setInternalValue] = useState(value)
  const [isLoading, setIsLoading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const { notifySuccess, notifyError } = useMessage()
  const { t } = useTranslation()

  // 同步外部 value 变化到 internalValue
  useEffect(() => {
    if (value !== internalValue) {
      setInternalValue(value)
    }
  }, [value, internalValue])

  const doUpload = async (file: File) => {
    setIsLoading(true)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const uint8 = new Uint8Array(arrayBuffer)
      const res: FileItem = await api().svcComfy.uploadImage({
        fileItem: { filename: file.name, type: 'input' },
        image: uint8
      })
      if (!res.filename) {
        throw new Error('failed to upload image, response did not contain filename')
      }
      const uploadedName = fileItemToValue(res)
      setInternalValue(uploadedName)
      onChange(uploadedName)
    } catch (error) {
      console.error('[InputComfyImage] Upload failed:', error)
      notifyError(
        t('input.image.load_failed', {
          error: error instanceof Error ? error.message : t('input.image.check_comfy_connection')
        })
      )
    } finally {
      setIsLoading(false)
    }
  }

  const viewImage = useCallback(async () => {
    const res = await api().svcComfy.getView(valueToFileItem(internalValue))
    const image: Uint8Array = res.result
    if (!isLikelyImageBytes(image)) {
      throw new Error('invalid image bytes')
    }
    return image
  }, [internalValue])

  const handleLoadFromPhotoshop = async () => {
    try {
      setIsLoading(true)
      const res = await api().svcPhotoshop.loadImageFromPhotoshop({})

      // 将图片上传到 ComfyUI
      const fileItem: FileItem = await api().svcComfy.uploadImage({
        fileItem: { filename: res.fileName, type: 'input' },
        image: res.image
      })

      if (!fileItem.filename) {
        throw new Error(t('input.image.upload_missing_filename'))
      }

      const uploadedName = fileItemToValue(fileItem)
      setInternalValue(uploadedName)
      onChange(uploadedName)
      notifySuccess(t('input.image.photoshop_loaded'))
    } catch (error) {
      console.error(t('input.image.photoshop_load_failed_log'), error)
      notifyError(
        t('input.image.load_failed_short', {
          error: error instanceof Error ? error.message : String(error)
        })
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handleClear = useCallback(() => {
    setInternalValue('')
    onChange('')
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
  }, [onChange])

  useEffect(() => {
    let active = true
    ;(async () => {
      if (!internalValue) {
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return null
        })
        return
      }
      try {
        const bytes = await viewImage()
        if (!active) return
        const blob = new Blob([bytes as BlobPart], { type: 'image/*' })
        const url = URL.createObjectURL(blob)
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return url
        })
      } catch {
        // Image file doesn't exist anymore, clear the value
        console.warn('[InputComfyImage] Failed to load image, clearing value:', internalValue)
        if (active) {
          setInternalValue('')
          onChange('')
          setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev)
            return null
          })
        }
      }
    })()
    return () => {
      active = false
    }
  }, [internalValue, viewImage, onChange])

  return (
    <BaseInputComfyImage
      label={label}
      Icon={Icon}
      placeholder={placeholder}
      internalValue={internalValue}
      isLoading={isLoading}
      previewUrl={previewUrl}
      doUpload={doUpload}
      onClear={handleClear}
      buttonSlot={
        <Button
          size="small"
          variant="outlined"
          startIcon={<PhotoLibraryOutlined />}
          onClick={(e) => {
            e.stopPropagation()
            void handleLoadFromPhotoshop()
          }}
          disabled={isLoading}
          sx={{ ml: 'auto' }}
        >
          {t('input.image.load_from_photoshop')}
        </Button>
      }
    />
  )
}

export default InputComfyImage
