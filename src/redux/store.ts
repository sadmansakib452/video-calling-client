import { configureStore } from "@reduxjs/toolkit"
import callReducer from "./features/call/callSlice"
import messageReducer from "./features/message/messageSlice"

export const store = configureStore({
  reducer: {
    call: callReducer,
    message: messageReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore these action types
        ignoredActions: ["message/addMessage", "message/setMessages"],
        // Ignore these field paths in all actions
        ignoredActionPaths: ["payload.timestamp"],
        // Ignore these paths in the state
        ignoredPaths: ["message.messages"],
      },
    }),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
