import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:get_storage/get_storage.dart';
import 'package:go_router/go_router.dart';
import 'package:video_player/video_player.dart';
import 'package:youtube_player_iframe/youtube_player_iframe.dart';

import '../../core/theme.dart';
import '../../domain/entities/catalog_item.dart';
import '../catalog/catalog_cubit.dart';
import '../shared/widgets.dart';

// Matches the Android applicationId.
const youtubeOrigin = 'https://com.nexo.nexo';
const _youtubeHosts = {
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com'
};

/// Extracts a video id from watch, short-link, embed, live and shorts URLs.
String? youtubeVideoId(Uri uri) {
  if (!_youtubeHosts.contains(uri.host.toLowerCase())) return null;
  final id = uri.host.toLowerCase() == 'youtu.be'
      ? (uri.pathSegments.isEmpty ? null : uri.pathSegments.first)
      : uri.queryParameters['v'] ??
          (uri.pathSegments.length > 1 ? uri.pathSegments.last : null);
  return id != null && RegExp(r'^[\w-]{6,20}$').hasMatch(id) ? id : null;
}

/// Plays a live stream (HLS), a YouTube video, or a provider embed in-app.
class PlayerPage extends StatefulWidget {
  const PlayerPage(
      {super.key,
      required this.id,
      required this.name,
      this.url,
      this.type = 'channel',
      this.playbackKind = 'hls',
      this.category = '',
      this.trailerUrl,
      this.startFullscreen = false});
  final String id, name;
  final String? url;

  /// A YouTube trailer offered when the title itself cannot be played.
  final String? trailerUrl;

  /// Opens straight into full screen, used when changing channel from there.
  final bool startFullscreen;
  final String type;
  final String playbackKind;
  final String category;
  @override
  State<PlayerPage> createState() => _PlayerPageState();
}

class _PlayerPageState extends State<PlayerPage> {
  final _playerKey = GlobalKey();
  VideoPlayerController? _video;
  YoutubePlayerController? _youtube;
  Uri? _embed;
  String? _embedUserAgent;
  String? _error;
  bool _loading = true;
  late bool _fullscreen = widget.startFullscreen;
  bool _showControls = true;
  // True while a channel change keeps full screen for the next player.
  bool _keepFullscreen = false;
  // True once the channel's YouTube live stream has replaced its own stream.
  bool _usingYoutubeFallback = false;
  // Remembered across players and app restarts.
  double _volume = _storedVolume();
  bool _muted = _storedMuted();
  bool _fallbackTried = false;

  bool get _isLive => widget.type == 'channel';

  @override
  void initState() {
    super.initState();
    if (widget.startFullscreen) _setFullscreen(true);
    _init();
  }

  Uri? _safeUri(String? raw) {
    final uri = raw == null ? null : Uri.tryParse(raw);
    if (uri == null ||
        uri.scheme != 'https' ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty) {
      return null;
    }
    return uri;
  }

  Future<void> _init() async {
    final uri = _safeUri(widget.url);
    if (uri == null) {
      setState(() => _loading = false);
      return;
    }
    try {
      final videoId = youtubeVideoId(uri);
      if (videoId != null || widget.playbackKind == 'youtube') {
        if (videoId == null) {
          setState(() {
            _loading = false;
            _error = 'This YouTube link is invalid.';
          });
          return;
        }
        _youtube = _youtubeController(videoId);
        setState(() => _loading = false);
        return;
      }
      if (widget.playbackKind == 'iframe') {
        // Android's WebView marks itself with "; wv" in the user agent, which
        // some embed providers refuse to serve. Present as plain Chrome.
        String? userAgent;
        try {
          userAgent = (await InAppWebViewController.getDefaultUserAgent())
              .replaceAll('; wv', '');
        } catch (_) {}
        if (!mounted) return;
        setState(() {
          _embed = uri;
          _embedUserAgent = userAgent;
          _loading = false;
        });
        return;
      }
      final next = VideoPlayerController.networkUrl(uri,
          formatHint: uri.path.toLowerCase().endsWith('.mpd')
              ? VideoFormat.dash
              : uri.path.toLowerCase().contains('.m3u8')
                  ? VideoFormat.hls
                  : null);
      await next.initialize();
      if (!mounted) {
        await next.dispose();
        return;
      }
      await next.setVolume(_muted ? 0 : _volume);
      await next.play();
      setState(() {
        _video = next;
        _loading = false;
        _showControls = false;
      });
    } catch (_) {
      if (!mounted || await _playYoutubeFallback()) return;
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'This stream could not be played. Try again later.';
        });
      }
    }
  }

  YoutubePlayerController _youtubeController(String videoId) {
    _youtubeVolumeSet = false;
    final controller = YoutubePlayerController.fromVideoId(
        videoId: videoId,
        autoPlay: true,
        params: const YoutubePlayerParams(
            showControls: true,
            showFullscreenButton: false,
            strictRelatedVideos: true,
            // YouTube refuses embeds it cannot attribute (error 152/153).
            // An app-ID origin identifies this app as the embedder.
            origin: youtubeOrigin));
    // The player only accepts volume once it has loaded; apply it then.
    controller.listen((value) {
      if (value.playerState == PlayerState.playing && !_youtubeVolumeSet) {
        _youtubeVolumeSet = true;
        _applyVolume();
      }
    });
    return controller;
  }

  bool _youtubeVolumeSet = false;

  /// When a live channel's own stream fails, plays the channel's YouTube
  /// live stream instead, if it has one. Returns whether that worked.
  Future<bool> _playYoutubeFallback() async {
    if (!_isLive || _fallbackTried) return false;
    _fallbackTried = true;
    final cubit = context.read<CatalogCubit>();
    final channel =
        cubit.state.channels.where((item) => item.id == widget.id).firstOrNull;
    if (channel == null) return false;
    try {
      final url = await cubit.repository.channelYoutubeLive(channel.slug);
      final uri = url == null ? null : Uri.tryParse(url);
      final videoId = uri == null ? null : youtubeVideoId(uri);
      if (videoId == null || !mounted) return false;
      final failed = _video;
      setState(() {
        _video = null;
        _youtube = _youtubeController(videoId);
        _usingYoutubeFallback = true;
        _error = null;
        _loading = false;
      });
      await failed?.dispose();
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> _retry() async {
    await _video?.dispose();
    await _youtube?.close();
    setState(() {
      _video = null;
      _youtube = null;
      _embed = null;
      _error = null;
      _loading = true;
      _usingYoutubeFallback = false;
      _fallbackTried = false;
    });
    await _init();
  }

  Future<void> _setFullscreen(bool value) async {
    if (mounted && _fullscreen != value) setState(() => _fullscreen = value);
    await SystemChrome.setEnabledSystemUIMode(
        value ? SystemUiMode.immersiveSticky : SystemUiMode.edgeToEdge);
    await SystemChrome.setPreferredOrientations(value
        ? [DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight]
        : [DeviceOrientation.portraitUp]);
  }

  @override
  void dispose() {
    _video?.dispose();
    _youtube?.close();
    if (!_keepFullscreen) {
      SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
      SystemChrome.setPreferredOrientations(DeviceOrientation.values);
    }
    super.dispose();
  }

  static double _storedVolume() {
    try {
      return (GetStorage().read<num>('nexo.volume') ?? 1)
          .toDouble()
          .clamp(0, 1);
    } catch (_) {
      return 1;
    }
  }

  static bool _storedMuted() {
    try {
      return GetStorage().read<bool>('nexo.muted') ?? false;
    } catch (_) {
      return false;
    }
  }

  /// Applies the volume to whichever player is active and remembers it.
  Future<void> _applyVolume() async {
    final level = _muted ? 0.0 : _volume;
    try {
      await _video?.setVolume(level);
      final youtube = _youtube;
      if (youtube != null) {
        if (level == 0) {
          await youtube.mute();
        } else {
          await youtube.unMute();
          await youtube.setVolume((level * 100).round());
        }
      }
    } catch (_) {}
    try {
      GetStorage()
        ..write('nexo.volume', _volume)
        ..write('nexo.muted', _muted);
    } catch (_) {}
  }

  void _setVolume(double value) {
    setState(() {
      _volume = value;
      _muted = value == 0;
    });
    _applyVolume();
  }

  void _toggleMute() {
    setState(() {
      _muted = !_muted;
      // Unmuting at zero would stay silent; come back at a usable level.
      if (!_muted && _volume == 0) _volume = .5;
    });
    _applyVolume();
  }

  /// Embed players are third-party pages whose volume this app cannot reach;
  /// the phone's volume keys still work for them.
  bool get _hasVolumeControl => _video != null || _youtube != null;

  IconData get _volumeIcon => _muted || _volume == 0
      ? Icons.volume_off
      : _volume < .5
          ? Icons.volume_down
          : Icons.volume_up;

  Widget _muteButton({Color? background}) => IconButton.filledTonal(
      tooltip: _muted ? 'Unmute' : 'Mute',
      style: IconButton.styleFrom(
          backgroundColor: background ?? Colors.black54,
          foregroundColor: Colors.white),
      onPressed: _toggleMute,
      icon: Icon(_volumeIcon));

  Widget _volumeSlider() => SliderTheme(
      data: SliderTheme.of(context).copyWith(
          trackHeight: 3,
          activeTrackColor: kPink,
          inactiveTrackColor: Colors.white24,
          thumbColor: Colors.white,
          overlayShape: SliderComponentShape.noOverlay,
          thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 7)),
      child: Slider(
          value: _muted ? 0 : _volume,
          onChanged: _setVolume,
          semanticFormatterCallback: (value) =>
              'Volume ${(value * 100).round()}%'));

  /// Mute button with a slider beside it.
  Widget _volumeRow({Color? background}) =>
      Row(mainAxisSize: MainAxisSize.min, children: [
        _muteButton(background: background),
        SizedBox(width: 110, child: _volumeSlider()),
      ]);

  /// Mute button with a vertical slider under it, for the full-screen side bar.
  Widget _volumeColumn() => Column(mainAxisSize: MainAxisSize.min, children: [
        _muteButton(background: Colors.white12),
        const SizedBox(height: 8),
        SizedBox(
            height: 120,
            child: RotatedBox(quarterTurns: 3, child: _volumeSlider())),
      ]);

  Widget _fullscreenButton() => IconButton.filledTonal(
      tooltip: _fullscreen ? 'Exit full screen' : 'Full screen',
      style: IconButton.styleFrom(backgroundColor: Colors.black54),
      onPressed: () => _setFullscreen(!_fullscreen),
      icon: Icon(_fullscreen ? Icons.fullscreen_exit : Icons.fullscreen,
          color: Colors.white));

  Widget _videoSurface(VideoPlayerController controller) =>
      ValueListenableBuilder<VideoPlayerValue>(
        valueListenable: controller,
        builder: (context, value, _) {
          if (value.hasError && !_fallbackTried) {
            WidgetsBinding.instance
                .addPostFrameCallback((_) => _playYoutubeFallback());
          }
          return _videoControls(controller, value);
        },
      );

  Widget _videoControls(
          VideoPlayerController controller, VideoPlayerValue value) =>
      GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => setState(() => _showControls = !_showControls),
        child: Stack(fit: StackFit.expand, children: [
          Center(
              child: AspectRatio(
                  aspectRatio:
                      value.aspectRatio > 0 ? value.aspectRatio : 16 / 9,
                  child: VideoPlayer(controller))),
          if (value.isBuffering)
            const Center(child: CircularProgressIndicator(color: kPink)),
          if (value.hasError)
            Center(
                child: TextButton(
                    onPressed: _retry,
                    child: const Text('Playback stopped. Tap to retry.')))
          else if (_showControls || !value.isPlaying) ...[
            Center(
                child: IconButton.filledTonal(
                    tooltip: value.isPlaying ? 'Pause' : 'Play',
                    style:
                        IconButton.styleFrom(backgroundColor: Colors.black54),
                    onPressed: () => value.isPlaying
                        ? controller.pause()
                        : controller.play(),
                    iconSize: 40,
                    icon: Icon(value.isPlaying ? Icons.pause : Icons.play_arrow,
                        color: Colors.white))),
            Positioned(right: 8, bottom: 8, child: _fullscreenButton()),
            Positioned(left: 8, bottom: 8, child: _volumeRow()),
          ],
        ]),
      );

  Widget _embedView(Uri uri) => InAppWebView(
        initialUrlRequest: URLRequest(url: WebUri.uri(uri)),
        initialSettings: InAppWebViewSettings(
          javaScriptEnabled: true,
          domStorageEnabled: true,
          databaseEnabled: true,
          thirdPartyCookiesEnabled: true,
          mediaPlaybackRequiresUserGesture: false,
          allowsInlineMediaPlayback: true,
          iframeAllowFullscreen: true,
          transparentBackground: false,
          userAgent: _embedUserAgent ?? '',
          // Receive window.open calls in onCreateWindow so ad popups can be
          // refused instead of replacing the player.
          supportMultipleWindows: true,
          javaScriptCanOpenWindowsAutomatically: false,
          useShouldOverrideUrlLoading: true,
        ),
        onCreateWindow: (controller, action) async => false,
        // Embed providers commonly hand playback to a separate HTTPS host.
        // Keep those redirects working, but reject insecure or app-intent
        // navigation (intent://, market://, http://).
        shouldOverrideUrlLoading: (controller, action) async {
          final target = action.request.url;
          return target != null &&
                  target.scheme == 'https' &&
                  target.host.isNotEmpty
              ? NavigationActionPolicy.ALLOW
              : NavigationActionPolicy.CANCEL;
        },
        onEnterFullscreen: (_) => _setFullscreen(true),
        onExitFullscreen: (_) => _setFullscreen(false),
        onReceivedError: (controller, request, error) {
          if (request.isForMainFrame == true) _embedUnavailable();
        },
        // Sources answer 404 (or another error status) for titles they
        // do not carry.
        onReceivedHttpError: (controller, request, response) {
          if (request.isForMainFrame == true &&
              (response.statusCode ?? 0) >= 400) {
            _embedUnavailable();
          }
        },
      );

  void _embedUnavailable() {
    if (!mounted || _embed == null) return;
    setState(() {
      _embed = null;
      _error = 'This title is not available from the source right now.';
    });
  }

  bool get _hasTrailer =>
      widget.trailerUrl != null && widget.trailerUrl!.isNotEmpty;

  void _watchTrailer() => context.pushReplacement(Uri(
          path: '/player/${Uri.encodeComponent('${widget.id}-trailer')}',
          queryParameters: {
            'name': '${widget.name} · Trailer',
            'url': widget.trailerUrl!,
            'type': 'video',
            'playbackKind': 'youtube',
            'category': 'Trailer',
          }).toString());

  Widget _player() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator(color: kPink));
    }
    if (_youtube != null) {
      // Full screen is handled by this page's own button; a vertical swipe on
      // the video should not toggle it.
      return YoutubePlayer(
          controller: _youtube!,
          aspectRatio: 16 / 9,
          enableFullScreenOnVerticalDrag: false);
    }
    if (_embed != null) return _embedView(_embed!);
    if (_video != null) return _videoSurface(_video!);
    return Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
      const Icon(Icons.tv_off_outlined, size: 45, color: Colors.white38),
      const SizedBox(height: 12),
      Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Text(_error ?? 'Not available right now',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70))),
      const SizedBox(height: 8),
      Wrap(spacing: 8, alignment: WrapAlignment.center, children: [
        if (widget.url != null)
          TextButton(onPressed: _retry, child: const Text('Retry')),
        if (_hasTrailer)
          TextButton.icon(
              onPressed: _watchTrailer,
              icon: const Icon(Icons.smart_display_outlined),
              label: const Text('Watch Trailer')),
      ]),
    ]));
  }

  void _openChannel(CatalogItem item) {
    _keepFullscreen = _fullscreen;
    context.pushReplacement(
        '${playerLocation(item)}${_fullscreen ? '&fullscreen=1' : ''}');
  }

  Widget _channelButton(List<CatalogItem> related, int index,
      {required bool previous}) {
    final target = previous ? index - 1 : index + 1;
    final enabled = target >= 0 && target < related.length;
    return IconButton.filledTonal(
        tooltip: previous ? 'Previous channel' : 'Next channel',
        onPressed: enabled ? () => _openChannel(related[target]) : null,
        style: IconButton.styleFrom(
            backgroundColor: Colors.white12, foregroundColor: Colors.white),
        icon: Icon(previous ? Icons.skip_previous : Icons.skip_next));
  }

  /// Previous and next channel buttons at the left and right edges.
  Widget _channelButtons(List<CatalogItem> related, int index) => Align(
        alignment: Alignment.center,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            IconButton.filledTonal(
                tooltip: 'Previous channel',
                onPressed:
                    index > 0 ? () => _openChannel(related[index - 1]) : null,
                style: IconButton.styleFrom(
                    backgroundColor: Colors.black54,
                    foregroundColor: Colors.white),
                icon: const Icon(Icons.skip_previous)),
            IconButton.filledTonal(
                tooltip: 'Next channel',
                onPressed: index + 1 < related.length
                    ? () => _openChannel(related[index + 1])
                    : null,
                style: IconButton.styleFrom(
                    backgroundColor: Colors.black54,
                    foregroundColor: Colors.white),
                icon: const Icon(Icons.skip_next)),
          ],
        ),
      );

  @override
  Widget build(BuildContext context) {
    final state = context.watch<CatalogCubit>().state;
    final related = _isLive
        ? state.channels
            .where((item) => item.category == widget.category)
            .toList()
        : const <CatalogItem>[];
    final index = related.indexWhere((item) => item.id == widget.id);
    final current = index >= 0 ? related[index] : null;
    // The embed and YouTube players draw their own controls, so full screen
    // is offered from the app bar for those.
    final needsBarFullscreen = _youtube != null || _embed != null;
    final nativeVideo = needsBarFullscreen;
    final hasChannelNav = index >= 0 && related.length > 1;
    final surface = ColoredBox(
        color: Colors.black,
        child: KeyedSubtree(key: _playerKey, child: _player()));

    return PopScope(
      canPop: !_fullscreen,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _setFullscreen(false);
      },
      child: Scaffold(
        backgroundColor: _fullscreen ? Colors.black : kBg,
        appBar: _fullscreen
            ? null
            : AppBar(
                title: Text(widget.name,
                    maxLines: 1, overflow: TextOverflow.ellipsis),
                actions: [
                    if (needsBarFullscreen)
                      IconButton(
                          tooltip: 'Full screen',
                          onPressed: () => _setFullscreen(true),
                          icon: const Icon(Icons.fullscreen)),
                  ]),
        body: _fullscreen && nativeVideo
            // YouTube and embed players are native views that cover anything
            // drawn over them, so their controls sit in the side bars instead.
            ? SafeArea(
                child: Row(children: [
                  SizedBox(
                      width: 64,
                      child: Column(children: [
                        const SizedBox(height: 8),
                        if (_hasVolumeControl) _volumeColumn(),
                        Expanded(
                            child: Center(
                                child: hasChannelNav
                                    ? _channelButton(related, index,
                                        previous: true)
                                    : null)),
                      ])),
                  Expanded(child: surface),
                  SizedBox(
                      width: 64,
                      child: Column(children: [
                        const SizedBox(height: 8),
                        _fullscreenButton(),
                        Expanded(
                            child: Center(
                                child: hasChannelNav
                                    ? _channelButton(related, index,
                                        previous: false)
                                    : null)),
                      ])),
                ]),
              )
            : _fullscreen
                ? Stack(children: [
                    Positioned.fill(child: surface),
                    // Shown with the player controls: tap the video to reveal.
                    if (index >= 0 &&
                        related.length > 1 &&
                        (_showControls || _video == null))
                      Positioned.fill(
                          child: SafeArea(
                              child: Padding(
                                  padding:
                                      const EdgeInsets.symmetric(horizontal: 8),
                                  child: _channelButtons(related, index)))),
                    if (needsBarFullscreen)
                      Positioned(
                          top: 8,
                          right: 8,
                          child: SafeArea(child: _fullscreenButton())),
                  ])
                : LayoutBuilder(builder: (context, constraints) {
                    final videoHeight = math.min(constraints.maxWidth * 9 / 16,
                        constraints.maxHeight * .58);
                    return Column(children: [
                      SizedBox(
                          height: videoHeight,
                          child: Stack(children: [
                            Positioned.fill(child: surface),
                            if (hasChannelNav && !nativeVideo)
                              _channelButtons(related, index),
                          ])),
                      if (nativeVideo && (hasChannelNav || _hasVolumeControl))
                        Padding(
                          padding: const EdgeInsets.fromLTRB(8, 6, 8, 0),
                          child: Row(children: [
                            if (hasChannelNav)
                              TextButton.icon(
                                  onPressed: index > 0
                                      ? () => _openChannel(related[index - 1])
                                      : null,
                                  icon: const Icon(Icons.skip_previous),
                                  label: const Text('Previous')),
                            const Spacer(),
                            if (_hasVolumeControl)
                              Flexible(
                                  child: FittedBox(
                                      fit: BoxFit.scaleDown,
                                      child: _volumeRow(
                                          background: Colors.transparent))),
                            const Spacer(),
                            if (hasChannelNav)
                              TextButton.icon(
                                  onPressed: index + 1 < related.length
                                      ? () => _openChannel(related[index + 1])
                                      : null,
                                  iconAlignment: IconAlignment.end,
                                  icon: const Icon(Icons.skip_next),
                                  label: const Text('Next')),
                          ]),
                        ),
                      Expanded(
                          child: ListView(
                              padding:
                                  const EdgeInsets.fromLTRB(18, 18, 18, 28),
                              children: [
                            Row(children: [
                              if (_isLive)
                                Container(
                                    margin: const EdgeInsets.only(right: 10),
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                        color: kPink,
                                        borderRadius: BorderRadius.circular(4)),
                                    child: const Text('LIVE',
                                        style: TextStyle(
                                            fontSize: 11,
                                            fontWeight: FontWeight.w800,
                                            letterSpacing: 1))),
                              Expanded(
                                  child: Text(
                                      widget.category.isEmpty
                                          ? widget.type.toUpperCase()
                                          : widget.category,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                          color: kMuted,
                                          fontWeight: FontWeight.w600))),
                              if (current != null)
                                IconButton(
                                    tooltip: state.isSaved(current)
                                        ? 'Remove from My List'
                                        : 'Add to My List',
                                    onPressed: () => context
                                        .read<CatalogCubit>()
                                        .toggle(current),
                                    icon: Icon(
                                        state.isSaved(current)
                                            ? Icons.bookmark
                                            : Icons.bookmark_border,
                                        color: kPink)),
                            ]),
                            const SizedBox(height: 8),
                            Text(widget.name,
                                style: const TextStyle(
                                    fontSize: 22,
                                    height: 1.2,
                                    fontWeight: FontWeight.w700)),
                            if (_usingYoutubeFallback)
                              const Padding(
                                  padding: EdgeInsets.only(top: 10),
                                  child: Row(children: [
                                    Icon(Icons.info_outline,
                                        size: 16, color: kMuted),
                                    SizedBox(width: 6),
                                    Expanded(
                                        child: Text(
                                            "The channel's stream isn't working, so this is its YouTube live stream.",
                                            style: TextStyle(
                                                color: kMuted, fontSize: 13))),
                                  ])),
                            // Sources can show their own "not found" page without
                            // an error status, so always offer a way out.
                            if (_embed != null && _hasTrailer)
                              Align(
                                  alignment: Alignment.centerLeft,
                                  child: TextButton.icon(
                                      onPressed: _watchTrailer,
                                      style: TextButton.styleFrom(
                                          padding: EdgeInsets.zero),
                                      icon: const Icon(
                                          Icons.smart_display_outlined),
                                      label: const Text(
                                          'Not playing? Watch the trailer'))),
                            if (current != null &&
                                current.synopsis.isNotEmpty) ...[
                              const SizedBox(height: 12),
                              Text(current.synopsis,
                                  maxLines: 4,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                      color: Colors.white60, height: 1.5)),
                            ],
                            if (related.length > 1) ...[
                              const SizedBox(height: 26),
                              Text('More in ${widget.category}',
                                  style: const TextStyle(
                                      fontSize: 18,
                                      fontWeight: FontWeight.w600)),
                              const SizedBox(height: 14),
                              // As many columns as fit, sized to fill the row.
                              LayoutBuilder(builder: (context, box) {
                                const gap = 14.0;
                                final columns =
                                    ((box.maxWidth + gap) / (76 + gap))
                                        .floor()
                                        .clamp(3, 10);
                                final size =
                                    ((box.maxWidth - gap * (columns - 1)) /
                                            columns)
                                        .floorToDouble();
                                return Wrap(
                                    spacing: gap,
                                    runSpacing: gap,
                                    children: [
                                      for (final item in related
                                          .where((item) => item.id != widget.id)
                                          .take(24))
                                        _RelatedChannel(
                                            item: item,
                                            size: size,
                                            onTap: () => _openChannel(item)),
                                    ]);
                              }),
                            ],
                            const SizedBox(height: 22),
                            const Text(
                                'Availability depends on rights and the source provider.',
                                style: TextStyle(
                                    color: kMuted, fontSize: 12, height: 1.5)),
                          ])),
                    ]);
                  }),
      ),
    );
  }
}

class _RelatedChannel extends StatelessWidget {
  const _RelatedChannel(
      {required this.item, required this.size, required this.onTap});
  final CatalogItem item;
  final double size;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => SizedBox(
        width: size,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Column(children: [
            Container(
                width: size,
                height: size,
                clipBehavior: Clip.antiAlias,
                padding: EdgeInsets.all(size * .14),
                decoration: const BoxDecoration(
                    shape: BoxShape.circle, color: Colors.white),
                child: Artwork(
                    url: item.logoUrl,
                    label: item.name.characters.first.toUpperCase(),
                    fit: BoxFit.contain,
                    cacheWidth: 160)),
            const SizedBox(height: 6),
            Text(item.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 11, color: kMuted)),
          ]),
        ),
      );
}
