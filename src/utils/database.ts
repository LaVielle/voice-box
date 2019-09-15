import firebase from '../firebase'

interface MessageDocument {
  shortId: string
  downloadURL: string
  // owner: string // TODO: add id of message owner
}

export const createMessage = async (message: MessageDocument) => {
  try {
    const ref = await firebase.db.collection('messages').add(message)
    return ref
  } catch (error) {
    console.log('Error creating message document:', error)
  }
}

export const getMessageByShortId = async (shortId: string) => {
  try {
    const querySnapshot = await firebase.db
      .collection('messages')
      .where('shortId', '==', shortId)
      .get()

    if (querySnapshot.docs.length) {
      return querySnapshot.docs[0].data()
    }
    throw new Error('No message found for this id.')
  } catch (error) {
    console.log('Error fetching message document:', error)
  }
}

export const getMessages = async () => {
  try {
    const querySnapshot = await firebase.db.collection('messages').get()

    if (querySnapshot.docs.length) {
      return querySnapshot.docs.map(message => message.data())
    }

    throw new Error('No messages found.')
  } catch (error) {
    console.log('Error fetching messages:', error)
  }
}