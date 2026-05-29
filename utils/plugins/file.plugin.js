'use strict'
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k
        var desc = Object.getOwnPropertyDescriptor(m, k)
        if (
          !desc ||
          ('get' in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k]
            }
          }
        }
        Object.defineProperty(o, k2, desc)
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k
        o[k2] = m[k]
      })
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, 'default', { enumerable: true, value: v })
      }
    : function (o, v) {
        o['default'] = v
      })
var __importStar =
  (this && this.__importStar) ||
  function (mod) {
    if (mod && mod.__esModule) return mod
    var result = {}
    if (mod != null)
      for (var k in mod)
        if (k !== 'default' && Object.prototype.hasOwnProperty.call(mod, k))
          __createBinding(result, mod, k)
    __setModuleDefault(result, mod)
    return result
  }
Object.defineProperty(exports, '__esModule', { value: true })
exports.FileSystemService = void 0
const fs = __importStar(require('fs'))
const path = __importStar(require('path'))
const client_s3_1 = require('@aws-sdk/client-s3')
const s3_request_presigner_1 = require('@aws-sdk/s3-request-presigner')
//? Example use:
//? const fileService = new FileSystemService({
//?   isCloud: true,
//?   cloudConfig: {
//?     endpoint: process.env.DO_SPACES_URL!,
//?     region: process.env.DO_SPACES_REGION!,
//?     bucket: process.env.DO_SPACES_BUCKET!,
//?     accessKeyId: process.env.DO_SPACES_ID_KEY!,
//?     secretAccessKey: process.env.DO_SPACES_SECRET_KEY!,
//?   },
//? });
class FileSystemService {
  constructor(options) {
    this.isCloud = options?.isCloud || false
    this.documentPath = path.join(__dirname, '/../../documents')
    if (this.isCloud) {
      // if (!options?.cloudConfig) throw "S3 undefined";
      // const { endpoint, region, bucket, accessKeyId, secretAccessKey } = options.cloudConfig;
      this.bucket = process.env.DO_SPACES_BUCKET
      this.s3Client = new client_s3_1.S3Client({
        endpoint: process.env.DO_SPACES_URL,
        region: process.env.DO_SPACES_REGION,
        credentials: {
          accessKeyId: process.env.DO_SPACES_ID_KEY,
          secretAccessKey: process.env.DO_SPACES_SECRET_KEY
        }
      })
    } else {
      this.createPath()
    }
  }
  createPath() {
    if (!this.isCloud) {
      this.checkPath(this.documentPath)
    }
  }
  checkPath(pathName) {
    if (!fs.existsSync(pathName)) {
      fs.mkdirSync(pathName, { recursive: true })
    }
  }
  writeDocumentByCause(pdfArray, subPath, filename) {
    return this.save(pdfArray, subPath, filename)
  }
  async save(pdfArray, cause, filename) {
    const buffer = Buffer.from(pdfArray)
    if (this.isCloud) {
      await this.uploadToS3Bucket(cause, filename, buffer)
    } else {
      const localPath = path.join(this.documentPath, cause)
      this.checkPath(localPath)
      fs.writeFileSync(path.join(localPath, `${filename}.pdf`), buffer)
    }
  }
  async uploadToS3Bucket(cause, fileName, buffer) {
    try {
      await this.s3Client.send(
        new client_s3_1.PutObjectCommand({
          Bucket: this.bucket,
          Key: `general-causes/${cause}/${fileName}.pdf`,
          ContentType: 'application/pdf',
          Body: buffer
        })
      )
      console.log('PDF uploaded successfully.')
    } catch (error) {
      console.error('Error uploading PDF:', error)
      throw error
    }
  }
  async getSignedS3Url(input, expiresIn = 60) {
    if (!this.isCloud) {
      throw new Error('Signed URLs are not supported in local mode.')
    }
    const { fileName, cause } = input
    const command = new client_s3_1.GetObjectCommand({
      Bucket: this.bucket,
      Key: `general-causes/${cause}/${fileName}`
    })
    try {
      return await (0, s3_request_presigner_1.getSignedUrl)(
        this.s3Client,
        command,
        { expiresIn }
      )
    } catch (error) {
      console.error('Error generating signed URL:', error)
      throw error
    }
  }
}
exports.FileSystemService = FileSystemService
