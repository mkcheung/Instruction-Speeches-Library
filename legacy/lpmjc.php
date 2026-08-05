<?php
echo '<pre>';
	printf("%015.2f\n\n", 10.3333);
	$aString = 'RogerOne';
	printf("[%'#10s]\n\n", $aString );
	printf("[%'@20s]\n\n", $aString);

    date_default_timezone_set('America/Los_Angeles');
    echo date('l n/j/y, G:i:s A', mktime(7, 11, 0, 6, 11, 2013));
echo '</pre>';


echo '<pre>';
	printf("%05.2f\n\n", 3.444);

	$stringP = "Rogue";
	printf("[%-'@10s]\n\n", $stringP);
echo '</pre>';

echo '<pre>' ;
	printf("%05.3f\n\n", 9.875);

 $star = "reverse";

printf("[%'#10s]\n\n", $star);

echo '</pre>' ;
?>