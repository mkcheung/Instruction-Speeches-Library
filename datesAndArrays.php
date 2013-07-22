
<?php

// Write a description of today's time
date_default_timezone_set('America/Los_Angeles');
$todaysDate = date('F j, Y, g:i A', time());
echo $todaysDate;

echo '</br>';

date_default_timezone_set('America/Los_Angeles');
$todaysDate = date('n/j/y, G:i:s A', time());
echo $todaysDate;

echo '</br>';

date_default_timezone_set('America/Los_Angeles');
$date = date('m/j/Y G:i:s A', time());
echo $date; 
echo '</br>';

$testString = 'tester';
echo ucfirst($testString);

echo '</br>';
date_default_timezone_set('America/Los_Angeles');

$date = date('F j, Y G:m a', time());
echo $date;

echo '</br>';
date_default_timezone_set('America/Los_Angeles');
$date = date('n/j/y, g:m: a',time());
echo $date;

echo '</br>';
$testString = 'Testing-This-Again';
$components[] = preg_split('/-/', $testString);
print_r($components);

echo '</br>';
$testString2 = "RestAndRecover";
$components2[] = preg_split('/And/', $testString2);
print_r($components2);



/**************************/
date_default_timezone_set("America/Los_Angeles");
$date = date("F j, g:m A", time());
$todaysDate = "Todays_Date";
$todaysDateProperFormat = preg_split("/_/", $todaysDate);
echo '</br>';
print_r($todaysDateProperFormat);
echo '</br>';
echo($date);

$numericContent = array(2,1,5,7,3,7,4);
echo '</br>';
echo(min($numericContent));
echo '</br>';
echo(max($numericContent));
echo '</br>';
print_r($numericContent);
sort($numericContent);
echo '</br>';
print_r($numericContent);
echo '</br>';

$assembled = implode(" * ",$numericContent);
echo $assembled;
echo '</br>';

$separated = explode(" * ", $assembled);
print_r($separated);
echo '</br>';
echo in_array(3, $separated);
echo '</br>';
$oneUnit = array_shift($separated);
echo $oneUnit;
$oneUnit = array_shift($separated);
echo $oneUnit;
?>




	</body>
</html>