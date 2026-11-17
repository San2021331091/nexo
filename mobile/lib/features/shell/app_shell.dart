import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../discover/discover_page.dart';
import '../home/home_page.dart';
import '../live/live_page.dart';
import '../my_list/my_list_page.dart';

const _destinations = [
  (label: 'Home', icon: Icons.home_outlined, activeIcon: Icons.home_rounded),
  (label: 'Live TV', icon: Icons.live_tv_outlined, activeIcon: Icons.live_tv),
  (label: 'Discover', icon: Icons.search, activeIcon: Icons.search),
  (
    label: 'My List',
    icon: Icons.bookmarks_outlined,
    activeIcon: Icons.bookmarks
  ),
];

/// The root scaffold: four destinations behind a persistent bottom bar.
class AppShell extends StatefulWidget {
  const AppShell({super.key});
  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _index = 0;
  // Pages are built on first visit and then kept alive.
  final _visited = <int>{0};

  @override
  Widget build(BuildContext context) => PopScope(
        canPop: _index == 0,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) setState(() => _index = 0);
        },
        child: Scaffold(
          body: IndexedStack(index: _index, children: [
            const HomePage(),
            _visited.contains(1) ? const LivePage() : const SizedBox.shrink(),
            _visited.contains(2)
                ? const DiscoverPage()
                : const SizedBox.shrink(),
            _visited.contains(3) ? const MyListPage() : const SizedBox.shrink(),
          ]),
          bottomNavigationBar: _BottomBar(
              index: _index,
              onSelect: (value) => setState(() {
                    _visited.add(value);
                    _index = value;
                  })),
        ),
      );
}

class _BottomBar extends StatelessWidget {
  const _BottomBar({required this.index, required this.onSelect});
  final int index;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) => DecoratedBox(
        decoration: const BoxDecoration(
            color: kNavBar,
            border: Border(top: BorderSide(color: Color(0x1FFFFFFF)))),
        child: SafeArea(
          top: false,
          child: SizedBox(
            height: 49 + MediaQuery.textScalerOf(context).scale(13) * 1.35,
            child: Row(children: [
              for (var item = 0; item < _destinations.length; item++)
                Expanded(
                    child: Semantics(
                  selected: item == index,
                  button: true,
                  child: InkWell(
                    onTap: () => onSelect(item),
                    child: Column(children: [
                      // The pink marker that sits on the bar's top edge.
                      Container(
                          height: 4,
                          width: 44,
                          decoration: BoxDecoration(
                              color: item == index ? kPink : Colors.transparent,
                              borderRadius: const BorderRadius.vertical(
                                  bottom: Radius.circular(4)))),
                      const Spacer(),
                      Icon(
                          item == index
                              ? _destinations[item].activeIcon
                              : _destinations[item].icon,
                          size: 26,
                          color: item == index ? kPink : Colors.white70),
                      const SizedBox(height: 4),
                      Text(_destinations[item].label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: item == index ? kPink : Colors.white70)),
                      const SizedBox(height: 7),
                    ]),
                  ),
                )),
            ]),
          ),
        ),
      );
}
