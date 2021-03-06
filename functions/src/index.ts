import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import * as ffmpeg from 'fluent-ffmpeg'
import * as ffmpeg_static from 'ffmpeg-static'
// @ts-ignore
import * as waveform_util from 'waveform-util'

const serviceAccount = require('../secrets/voice-box-dev-ed067e31c2c1.json')

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'voice-box-dev.appspot.com',
})

/**
 *
 * Mostly copied from https://github.com/firebase/functions-samples/blob/master/ffmpeg-convert-audio/functions/index.js
 *
 * Converts an audio file to mp3.
 *
 * */
exports.encodeAudioToMP3 = functions.firestore
  .document('messages/{messageId}')
  .onCreate(async (snapshot, context) => {
    const message: any = snapshot.data() // FIXME: use a better type
    console.log('context:', context)
    console.log('message:', message)

    // Get storage object
    const bucket = admin.storage().bucket()
    const object = bucket.file(message.storageFullPath)
    const filePath = object.name

    // TODO: get the contentType so we can check if the file is actually audio
    // const contentType = object.type
    //
    // // Exit if the file is not audio
    // if (contentType.startsWith('audio/')) {
    //   console.log('Content is not audio')
    //   return null
    // }

    // Helper to make an ffmpeg command return a promise.
    const ffmpegCommandAsync = (cmd: ffmpeg.FfmpegCommand) =>
      new Promise((resolve, reject) => {
        cmd
          .on('end', resolve)
          .on('error', reject)
          .run()
      })

    const fileName = path.basename(filePath)

    if (fileName.endsWith('_output.mp3')) {
      console.log('Audio file was already converted')
      return null
    }

    const tempFilePath = path.join(os.tmpdir(), fileName)

    // We add a '_output.mp3' suffix to target audio file name.
    // That's where we'll upload the converted audio.
    const targetTempFileName = fileName.replace(/\.[^/.]+$/, '') + '_output.mp3'
    const targetTempFilePath = path.join(os.tmpdir(), targetTempFileName)
    const targetStorageFilePath = path.join(
      path.dirname(filePath),
      targetTempFileName
    )

    await object.download({ destination: tempFilePath })

    // Convert the audio to mp3
    const command = ffmpeg(tempFilePath)
      .setFfmpegPath(ffmpeg_static.path)
      .format('mp3')
      .output(targetTempFilePath)

    await ffmpegCommandAsync(command)

    // get waveform
    const createWaveformAsync = () =>
      new Promise((resolve, reject) => {
        waveform_util.generate_peaks(
          targetTempFilePath, //audio_path
          200, // output_width
          message.duration, // duration
          44100, // sample_rate
          2, //channels
          (err: any, peaks_obj: unknown) => {
            if (err) {
              reject(err)
            } else {
              resolve(peaks_obj)
            }
          }
        )
      })

    let generatedWaveform: number[] = []

    try {
      const waveformData: any = await createWaveformAsync()
      generatedWaveform = waveformData.peaks
    } catch (error) {
      console.log('Error generating waveform:', error)
    }

    const uploadedMP3 = await bucket.upload(targetTempFilePath, {
      destination: targetStorageFilePath,
    })

    // Delete the local files once audio has been uploaded
    fs.unlinkSync(tempFilePath)
    fs.unlinkSync(targetTempFilePath)

    const uploadedFile = uploadedMP3[0]
    console.log('uploadedFile', uploadedFile)

    // Get a read URL for the new file.
    // We must specify an expiry date, so we set one far in the future.
    const urls = await uploadedFile.getSignedUrl({
      action: 'read',
      expires: '03-09-2491',
    })

    // Update the database document:
    //  - update download url
    //  - remove storageFullPath field
    await admin
      .firestore()
      .collection('messages')
      .doc(context.params.messageId)
      .update({
        downloadURL: urls[0],
        storageFullPath: admin.firestore.FieldValue.delete(),
        isAudioProcessing: admin.firestore.FieldValue.delete(),
        waveform: generatedWaveform,
      })

    // Delete the old audio file
    await object.delete()

    return true
  })
