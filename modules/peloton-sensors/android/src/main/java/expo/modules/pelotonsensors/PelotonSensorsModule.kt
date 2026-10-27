package expo.modules.pelotonsensors

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Message
import android.os.Messenger
import android.os.Parcel
import android.util.Log
import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

private const val TAG = "PelotonSensors"

// Original Bike (and Bike gen 2 tablets): Messenger-based service, one repeating request per metric.
private const val V1_ACTION = "android.intent.action.peloton.SensorData"
private const val V1_PACKAGE = "com.peloton.service.SensorData"
private const val V1_CMD_RPM = 1
private const val V1_CMD_POWER = 2
private const val V1_CMD_RESISTANCE = 3

// Bike+ (PLTN-TTR01): AIDL-style binder, polled with a raw transact that returns a BikeData parcel.
private const val V2_PACKAGE = "com.onepeloton.affernetservice"
private const val V2_INTERFACE = "com.onepeloton.affernetservice.IBikeInterface"
private const val V2_TRANSACT_GET_BIKE_DATA = 14
private const val V2_POLL_MS = 100L

private const val BIKE_PLUS_MODEL = "PLTN-TTR01"

class PelotonSensorsModule : Module() {
  private var connection: ServiceConnection? = null
  private var handlerThread: HandlerThread? = null
  private val polling = AtomicBoolean(false)

  // Latest readings; the two protocols report metrics independently so we merge here and emit snapshots.
  @Volatile private var power = 0.0
  @Volatile private var cadence = 0.0
  @Volatile private var resistance = 0.0

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context unavailable")

  private val isBikePlus: Boolean
    get() = Build.MODEL == BIKE_PLUS_MODEL

  override fun definition() = ModuleDefinition {
    Name("PelotonSensors")

    Events("onSample", "onStatus")

    Function("getDeviceInfo") {
      mapOf(
        "brand" to Build.BRAND,
        "model" to Build.MODEL,
        "sdkInt" to Build.VERSION.SDK_INT,
        "isPeloton" to (Build.BRAND == "Peloton"),
        "bike" to if (isBikePlus) "bikePlus" else "bike"
      )
    }

    Function("start") {
      start()
    }

    Function("stop") {
      stop()
    }

    OnDestroy {
      stop()
    }
  }

  private fun start() {
    if (connection != null) return

    val intent = if (isBikePlus) {
      Intent(V2_INTERFACE).setPackage(V2_PACKAGE)
    } else {
      Intent(V1_ACTION).setPackage(V1_PACKAGE)
    }

    val conn = object : ServiceConnection {
      override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
        if (binder == null) {
          emitStatus("unavailable", "Sensor service returned no binder")
          return
        }
        emitStatus("connected", name?.flattenToShortString())
        if (isBikePlus) startV2Polling(binder) else startV1Requests(binder)
      }

      override fun onServiceDisconnected(name: ComponentName?) {
        polling.set(false)
        emitStatus("disconnected", name?.flattenToShortString())
      }

      override fun onNullBinding(name: ComponentName?) {
        emitStatus("unavailable", "Null binding from ${name?.flattenToShortString()}")
      }

      override fun onBindingDied(name: ComponentName?) {
        polling.set(false)
        emitStatus("disconnected", "Binding died")
      }
    }

    emitStatus("connecting", intent.`package`)
    val bound = try {
      context.bindService(intent, conn, Context.BIND_AUTO_CREATE)
    } catch (e: SecurityException) {
      Log.w(TAG, "bindService refused", e)
      emitStatus("unavailable", e.message)
      false
    }

    if (bound) {
      connection = conn
    } else {
      // Not a Peloton, or the sensor service isn't installed. JS falls back to the simulator.
      runCatching { context.unbindService(conn) }
      emitStatus("unavailable", "Peloton sensor service not found")
    }
  }

  private fun stop() {
    polling.set(false)
    handlerThread?.quitSafely()
    handlerThread = null
    connection?.let { runCatching { context.unbindService(it) } }
    connection = null
  }

  private fun startV1Requests(binder: IBinder) {
    val ht = HandlerThread("PelotonSensors").also { it.start() }
    handlerThread = ht
    val service = Messenger(binder)

    // One reply Messenger per metric so each handler knows which value it receives.
    fun request(command: Int, onValue: (Float) -> Unit) {
      val replyHandler = object : Handler(ht.looper) {
        override fun handleMessage(msg: Message) {
          if (msg.what < 0) {
            Log.w(TAG, "Invalid sensor response for command $command")
            return
          }
          val data: Bundle = msg.data
          if (data.getString("responseHexString") == "TIME_OUT" || !data.containsKey("data")) return
          onValue(data.getFloat("data"))
          emitSample()
        }
      }
      service.send(Message.obtain().apply {
        what = command
        data = bundleOf("requestId" to UUID.randomUUID().toString())
        replyTo = Messenger(replyHandler)
      })
    }

    try {
      request(V1_CMD_POWER) {
        logRaw("power", it)
        power = it / 100.0
      }
      request(V1_CMD_RPM) { cadence = it.toDouble() }
      request(V1_CMD_RESISTANCE) { resistance = it.toDouble() }
    } catch (e: Exception) {
      Log.w(TAG, "Failed to send sensor requests", e)
      emitStatus("unavailable", e.message)
    }
  }

  private fun startV2Polling(binder: IBinder) {
    polling.set(true)
    thread(name = "PelotonSensorsPoll") {
      var consecutiveErrors = 0
      while (polling.get()) {
        val request = Parcel.obtain()
        val reply = Parcel.obtain()
        try {
          request.writeInterfaceToken(V2_INTERFACE)
          binder.transact(V2_TRANSACT_GET_BIKE_DATA, request, reply, 0)
          reply.readException()
          reply.readInt() // non-null marker before the parcelable
          // BikeData starts with: rpm, power, stepperMotorPosition, loadCellReading (longs),
          // currentResistance, targetResistance (ints). We only need these leading fields.
          val rpm = reply.readLong()
          val centiwatts = reply.readLong()
          reply.readLong()
          reply.readLong()
          reply.readInt()
          val targetResistance = reply.readInt()
          cadence = rpm.toDouble()
          power = centiwatts / 100.0
          resistance = targetResistance.toDouble()
          emitSample()
          consecutiveErrors = 0
        } catch (e: Exception) {
          consecutiveErrors++
          Log.w(TAG, "Bike+ poll failed ($consecutiveErrors)", e)
          if (consecutiveErrors >= 5) {
            polling.set(false)
            emitStatus("disconnected", "Bike+ sensor stopped responding")
          }
        } finally {
          request.recycle()
          reply.recycle()
        }
        Thread.sleep(V2_POLL_MS)
      }
    }
  }

  private var lastRawLog = 0L

  /** Raw readings once every couple of seconds, so units can be checked against the Peloton app. */
  private fun logRaw(metric: String, value: Float) {
    val now = System.currentTimeMillis()
    if (now - lastRawLog < 2000) return
    lastRawLog = now
    Log.i(TAG, "raw $metric=$value cadence=$cadence resistance=$resistance")
  }

  private fun emitSample() {
    sendEvent(
      "onSample",
      bundleOf(
        "power" to power,
        "cadence" to cadence,
        "resistance" to resistance,
        "timestamp" to System.currentTimeMillis().toDouble()
      )
    )
  }

  private fun emitStatus(state: String, detail: String?) {
    Log.i(TAG, "status=$state detail=$detail")
    sendEvent("onStatus", bundleOf("state" to state, "detail" to detail))
  }
}
