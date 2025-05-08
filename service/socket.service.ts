import { type Socket, io } from "socket.io-client";

export class SocketService {
  private static instance: SocketService;
  private socket: Socket | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private callId: string | null = null;
  private callTimeout: NodeJS.Timeout | null = null;
  private candidateQueue: RTCIceCandidate[] = [];
  private remoteDescSet = false;
  private currentReceiver: string | null = null;
  private currentCallId: string | null = null;
  private isVideoCall: boolean = false;

  // Event callbacks
  private onConnectCallback: (() => void) | null = null;
  private onDisconnectCallback: ((reason: string) => void) | null = null;
  private onConnectionErrorCallback: ((error: Error) => void) | null = null;
  private onJoinedCallCallback: ((data: any) => void) | null = null;
  private onCallRingingCallback: ((data: any) => void) | null = null;
  private onCallAcceptedCallback: ((data: any) => void) | null = null;
  private onCallEndedCallback: ((data: any) => void) | null = null;
  private onCallErrorCallback: ((data: any) => void) | null = null;
  private onCallRejectedCallback: ((data: any) => void) | null = null;
  private onCallNotAnsweredCallback: ((data: any) => void) | null = null;
  private onRecordingStartedCallback: (() => void) | null = null;
  private onRecordingStoppedCallback: (() => void) | null = null;
  private onIncomingCallCallback: ((data: any) => void) | null = null;
  private onCallCancelledCallback: ((data: any) => void) | null = null;
  private onCallTimeoutCallback: ((data: any) => void) | null = null;
  private onRemoteStreamCallback: ((stream: MediaStream) => void) | null = null;
  private onChatMessageCallback: ((message: any) => void) | null = null;

  private constructor() {}

  public static getInstance(): SocketService {
    if (!SocketService.instance) {
      SocketService.instance = new SocketService();
    }
    return SocketService.instance;
  }

  // Connection methods
  public async connect(token: string, baseUrl: string): Promise<void> {
    if (this.socket && this.socket.connected) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.socket = io(baseUrl, { auth: { token } });

      this.socket.on("connect", () => {
        console.log("Socket connected:", this.socket?.id);
        if (this.onConnectCallback) this.onConnectCallback();
        resolve();
      });

      this.socket.on("connect_error", (error) => {
        console.error("Socket connection error:", error);
        if (this.onConnectionErrorCallback)
          this.onConnectionErrorCallback(error);
        reject(error);
      });

      this.socket.on("disconnect", (reason) => {
        console.log("Socket disconnected:", reason);
        if (this.onDisconnectCallback) this.onDisconnectCallback(reason);
      });

      // Set up call event handlers
      this.setupCallEventHandlers();
    });
  }

  private setupCallEventHandlers(): void {
    if (!this.socket) return;

    this.socket.on("joinedCall", (data) => {
      console.log("Joined call system:", data);
      if (this.onJoinedCallCallback) this.onJoinedCallCallback(data);
    });

    this.socket.on("joinError", (data) => {
      console.error("Join error:", data);
      if (this.onCallErrorCallback) this.onCallErrorCallback(data);
    });

    this.socket.on("callRinging", (data) => {
      console.log("Call ringing:", data);
      this.callId = data.callId;
      if (this.onCallRingingCallback) this.onCallRingingCallback(data);
    });

    this.socket.on("callAccepted", async (data) => {
      console.log("Call accepted:", data);
      if (this.peerConnection) {
        try {
          await this.peerConnection.setRemoteDescription(
            new RTCSessionDescription(data.answer)
          );
          this.remoteDescSet = true;
          this.flushCandidates();
          if (this.onCallAcceptedCallback) this.onCallAcceptedCallback(data);
        } catch (error) {
          console.error("Error handling call accepted:", error);
        }
      }
    });

    this.socket.on("callEnded", (data) => {
      console.log("Call ended:", data);
      if (this.onCallEndedCallback) this.onCallEndedCallback(data);
    });

    this.socket.on("callError", (data) => {
      console.error("Call error:", data);
      if (this.onCallErrorCallback) this.onCallErrorCallback(data);
    });

    this.socket.on("callRejected", (data) => {
      console.log("Call rejected:", data);
      if (this.onCallRejectedCallback) this.onCallRejectedCallback(data);
    });

    this.socket.on("callNotAnswered", (data) => {
      console.log("Call not answered:", data);
      if (this.onCallNotAnsweredCallback) this.onCallNotAnsweredCallback(data);
    });

    this.socket.on("iceCandidate", async (data) => {
      try {
        console.log("Received ICE candidate");
        if (!this.remoteDescSet) {
          this.candidateQueue.push(data.candidate);
        } else if (this.peerConnection) {
          await this.peerConnection.addIceCandidate(
            new RTCIceCandidate(data.candidate)
          );
        }
      } catch (error) {
        console.error("Error handling ICE candidate:", error);
      }
    });

    this.socket.on("recordingStarted", () => {
      console.log("Recording started");
      if (this.onRecordingStartedCallback) this.onRecordingStartedCallback();
    });

    this.socket.on("recordingStopped", () => {
      console.log("Recording stopped");
      if (this.onRecordingStoppedCallback) this.onRecordingStoppedCallback();
    });

    this.socket.on("incomingCall", (data) => {
      console.log("Incoming call received:", data);
      console.log("Call details:", {
        callId: data.callId,
        caller: data.caller,
        appointmentId: data.appointmentId,
        isDoctorCall: data.isDoctorCall,
      });
      if (this.onIncomingCallCallback) this.onIncomingCallCallback(data);
    });

    this.socket.on("callCancelled", (data) => {
      console.log("Call cancelled:", data);
      if (this.onCallCancelledCallback) this.onCallCancelledCallback(data);
    });

    this.socket.on("chatMessage", (data) => {
      console.log("Chat message received:", data);
      if (this.onChatMessageCallback) this.onChatMessageCallback(data);
    });
  }

  // Call methods
  public joinCall(appointmentId: string): void {
    if (!this.socket) return;
    this.socket.emit("join", { appointmentId });
  }

  public async initiateCall(
    appointmentId: string,
    receiverId: string,
    isVideoCall: boolean
  ): Promise<void> {
    if (!this.socket) {
      console.error("Socket not initialized");
      throw new Error("Socket not initialized");
    }

    try {
      // Set receiver and call ID
      this.currentReceiver = receiverId;
      this.currentCallId = `call-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      this.isVideoCall = isVideoCall;

      // Clean up any existing peer connection
      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }

      // Set up local media first
      await this.setupLocalMedia(isVideoCall);

      if (!this.peerConnection) {
        throw new Error("Failed to create peer connection");
      }

      console.log(
        `Creating offer for ${receiverId} (${
          isVideoCall ? "video" : "audio"
        })...`
      );

      // Create an offer with appropriate constraints
      const offerOptions: RTCOfferOptions = {
        offerToReceiveAudio: true,
        offerToReceiveVideo: isVideoCall,
      };

      const pc = this.peerConnection as RTCPeerConnection;
      const offer = await pc.createOffer(offerOptions);
      console.log("Offer created:", offer);

      await pc.setLocalDescription(offer);
      console.log("Local description set");

      // Send the call request to the server
      this.socket.emit("call", {
        appointmentId,
        receiver: receiverId,
        offer,
        callId: this.currentCallId,
      });

      console.log(
        `Call request sent to ${receiverId} (${
          isVideoCall ? "video" : "audio"
        })`
      );
    } catch (error) {
      console.error("Error initiating call:", error);
      throw error;
    }
  }

  public async answerCall(
    callId: string,
    callerId: string,
    appointmentId: string,
    offer: RTCSessionDescriptionInit
  ): Promise<void> {
    if (!this.socket) {
      throw new Error("Socket not initialized");
    }

    try {
      // Set current receiver and call ID
      this.currentReceiver = callerId;
      this.currentCallId = callId;

      // Clean up any existing peer connection
      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }

      // Set up local media first
      await this.setupLocalMedia(false); // false for audio call

      if (!this.peerConnection) {
        throw new Error("Failed to create peer connection");
      }

      const pc = this.peerConnection as RTCPeerConnection;

      // Set the remote description from the offer
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      this.remoteDescSet = true;

      // Create an answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Send the answer to the caller
      this.socket.emit("answer", {
        callId,
        caller: callerId,
        appointmentId,
        answer,
      });

      // Flush any queued ICE candidates
      await this.flushCandidates();

      console.log("Call answered successfully");
    } catch (error) {
      console.error("Error answering call:", error);
      throw error;
    }
  }

  public rejectCall(callId: string): void {
    if (!this.socket) return;
    this.socket.emit("rejectCall", { callId });
  }

  public endCall(appointmentId: string): void {
    if (!this.socket || !this.callId) return;
    this.socket.emit("endCall", { callId: this.callId, appointmentId });
  }

  // Media methods
  public async setupLocalMedia(isVideoCall: boolean): Promise<MediaStream> {
    try {
      // Clean up existing stream if any
      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => track.stop());
        this.localStream = null;
      }

      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: isVideoCall
          ? {
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.localStream = stream;

      // Create peer connection if it doesn't exist
      if (!this.peerConnection) {
        this.createPeerConnection();
      }

      return stream;
    } catch (error) {
      console.error("Error accessing media devices:", error);
      throw error;
    }
  }

  private createPeerConnection(): void {
    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => {
          if (this.localStream) {
            pc.addTrack(track, this.localStream);
          }
        });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate && this.socket && this.currentReceiver) {
          this.socket.emit("iceCandidate", {
            callId: this.currentCallId,
            candidate: event.candidate,
            to: this.currentReceiver,
          });
        }
      };

      pc.ontrack = (event) => {
        this.remoteStream = event.streams[0];

        // Make sure audio tracks are enabled
        event.streams[0].getAudioTracks().forEach((track) => {
          track.enabled = true;
        });

        if (this.onRemoteStreamCallback) {
          this.onRemoteStreamCallback(event.streams[0]);
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log("ICE connection state:", pc.iceConnectionState);
      };

      pc.onconnectionstatechange = () => {
        console.log("Connection state:", pc.connectionState);
      };

      this.peerConnection = pc;
    } catch (error) {
      console.error("Error creating peer connection:", error);
      throw error;
    }
  }

  private async flushCandidates(): Promise<void> {
    if (!this.peerConnection) return;

    for (const candidate of this.candidateQueue) {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }

    this.candidateQueue = [];
  }

  // Media control methods
  public toggleAudio(): void {
    if (!this.localStream) return;

    const audioTracks = this.localStream.getAudioTracks();
    audioTracks.forEach((track) => {
      track.enabled = !track.enabled;
    });
  }

  // This is the main issue - when toggling hold, we're disabling ALL tracks
  public toggleHold(): void {
    if (!this.localStream) return;

    const tracks = this.localStream.getTracks();
    const isOnHold = tracks[0]?.enabled === false;

    tracks.forEach((track) => {
      track.enabled = isOnHold;
    });
  }

  // Chat methods
  public sendChatMessage(
    appointmentId: string,
    message: string,
    audioUrl?: string,
    imageUrl?: string,
    videoUrl?: string
  ): void {
    if (!this.socket) return;

    this.socket.emit("chatMessage", {
      appointmentId,
      message,
      audioUrl,
      imageUrl,
      videoUrl,
      timestamp: new Date().toISOString(),
    });
  }

  // Recording methods
  public startRecording(appointmentId: string): void {
    if (!this.socket) return;
    this.socket.emit("startRecording", { appointmentId });
  }

  public stopRecording(appointmentId: string): void {
    if (!this.socket) return;
    this.socket.emit("stopRecording", { appointmentId });
  }

  // Timeout methods
  public setCallTimeout(timeout: NodeJS.Timeout): void {
    this.callTimeout = timeout;
  }

  public clearCallTimeout(): void {
    if (this.callTimeout) {
      clearInterval(this.callTimeout);
      this.callTimeout = null;
    }
  }

  // Cleanup method
  public cleanup(): void {
    this.clearCallTimeout();

    // Close peer connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    // Stop all tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    // Reset state
    this.remoteStream = null;
    this.callId = null;
    this.currentCallId = null;
    this.currentReceiver = null;
    this.remoteDescSet = false;
    this.candidateQueue = [];

    // Don't disconnect the socket here as it might be used by other components
  }

  // Event registration methods
  public onConnect(callback: () => void): void {
    this.onConnectCallback = callback;
  }

  public onDisconnect(callback: (reason: string) => void): void {
    this.onDisconnectCallback = callback;
  }

  public onConnectionError(callback: (error: Error) => void): void {
    this.onConnectionErrorCallback = callback;
  }

  public onJoinedCall(callback: (data: any) => void): void {
    this.onJoinedCallCallback = callback;
  }

  public onCallRinging(callback: (data: any) => void): void {
    this.onCallRingingCallback = callback;
  }

  public onCallAccepted(callback: (data: any) => void): void {
    this.onCallAcceptedCallback = callback;
  }

  public onCallEnded(callback: (data: any) => void): void {
    this.onCallEndedCallback = callback;
  }

  public onCallError(callback: (data: any) => void): void {
    this.onCallErrorCallback = callback;
  }

  public onCallRejected(callback: (data: any) => void): void {
    this.onCallRejectedCallback = callback;
  }

  public onCallNotAnswered(callback: (data: any) => void): void {
    this.onCallNotAnsweredCallback = callback;
  }

  public onRecordingStarted(callback: () => void): void {
    this.onRecordingStartedCallback = callback;
  }

  public onRecordingStopped(callback: () => void): void {
    this.onRecordingStoppedCallback = callback;
  }

  public onIncomingCall(callback: (data: any) => void): void {
    this.onIncomingCallCallback = callback;
  }

  public onCallCancelled(callback: (data: any) => void): void {
    this.onCallCancelledCallback = callback;
  }

  public onCallTimeout(callback: (data: any) => void): void {
    this.onCallTimeoutCallback = callback;
  }

  public onRemoteStream(callback: (stream: MediaStream) => void): void {
    this.onRemoteStreamCallback = callback;
  }

  public onChatMessage(callback: (message: any) => void): void {
    this.onChatMessageCallback = callback;
  }
}
